import { useState } from 'react';
import { Linking, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import {
  budgetLines,
  ensurePlaidUserId,
  forgetPlaidItem,
  formatUsd,
  parseMoney,
  ingestSimulatedOutlier,
  isOutlier,
  notificationAllowed,
  rememberPlaidItem,
} from '@asset-aware/forecast-engine';
import { BANK_INSTITUTION_CAP, bankLinkIsUnlocked } from '@/entitlements';
import {
  createLinkToken,
  disconnectInstitution,
  exchangePublicToken,
  getHealth,
  commitBankCursor,
  loadSandboxLedger,
  openBankLink,
  saveSandboxLedger,
  sidecarUrl,
  syncInstitution,
  syncWritesHousehold,
} from '@/plaid/client';
import { useHousehold } from '@/state/context';
import { confirm } from '@/ui/confirm';
import { Body, Button, Card, Meta, Screen, Title, useFieldStyle } from '@/ui/primitives';

export default function PlaidScreen() {
  const field = useFieldStyle();
  const params = useLocalSearchParams<{ itemId?: string }>();
  const { household, settings, setHousehold, updateHousehold, patchSettings, readHousehold } = useHousehold();
  const [status, setStatus] = useState('Not linked');
  const [merchant, setMerchant] = useState('Pep Boys');
  const [amount, setAmount] = useState('1800');
  const [sandboxVersion, setSandboxVersion] = useState(0);
  const [plaidConsent, setPlaidConsent] = useState(false);
  const updateItem = typeof params.itemId === 'string' ? params.itemId : null;
  const linked = household?.plaidItems?.length ?? 0;
  const sandboxRows = sandboxVersion >= 0 ? loadSandboxLedger() : [];

  const link = async () => {
    if (!household) return;
    if (!bankLinkIsUnlocked()) {
      setStatus('Bank linking waits on the annual plan.');
      return;
    }
    if (!updateItem && linked >= BANK_INSTITUTION_CAP) {
      setStatus(`This plan covers ${BANK_INSTITUTION_CAP} institutions. Refresh one you already linked.`);
      return;
    }
    const live = readHousehold() ?? household;
    const withUser = ensurePlaidUserId(live);
    if (withUser.plaidUserId !== live.plaidUserId) setHousehold(withUser);
    try {
      const health = await getHealth();
      const sandbox = !syncWritesHousehold(health);
      const token = await createLinkToken(withUser.plaidUserId ?? '', updateItem);
      const linkedSession = await openBankLink(token);
      if (!linkedSession) {
        setStatus('Link closed. Your numbers are still here.');
        return;
      }
      if (updateItem) {
        const current = readHousehold() ?? withUser;
        const synced = await syncInstitution(current.plaidUserId ? current : { ...current, plaidUserId: withUser.plaidUserId }, updateItem, sandbox);
        if (sandbox) {
          const kept = loadSandboxLedger().filter((row) => row.itemId !== updateItem);
          saveSandboxLedger([...(synced.sandboxLedger ?? []), ...kept]);
          setSandboxVersion((value) => value + 1);
          setStatus('Sandbox refresh stayed on this screen.');
          return;
        }
        setHousehold(synced.household);
        commitBankCursor(synced.cursor);
        setStatus('Bank refreshed. Same institution, current balance only.');
        return;
      }
      const itemId = await exchangePublicToken(linkedSession.publicToken);
      const current = readHousehold() ?? withUser;
      const remembered = rememberPlaidItem(current.plaidUserId ? current : { ...current, plaidUserId: withUser.plaidUserId }, {
        itemId,
        institutionName: linkedSession.institutionName,
      });
      const synced = await syncInstitution(remembered, itemId, sandbox);
      if (sandbox) {
        const kept = loadSandboxLedger().filter((row) => row.itemId !== itemId);
        saveSandboxLedger([...(synced.sandboxLedger ?? []), ...kept]);
        setSandboxVersion((value) => value + 1);
        const latest = readHousehold();
        if (latest && !latest.plaidUserId && withUser.plaidUserId) {
          setHousehold({ ...latest, plaidUserId: withUser.plaidUserId });
        }
        setStatus('Sandbox sync stayed on this screen. The real household was not changed.');
        return;
      }
      setHousehold(synced.household);
      commitBankCursor(synced.cursor);
      setStatus(`Linked ${linkedSession.institutionName ?? 'bank'}. Current balances only.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Bank link didn’t finish. Your manual numbers are still here.');
    }
  };

  const sandboxLines = household
    ? budgetLines({ ...household, ledger: sandboxRows, expenses: household.expenses }, new Date()).filter(
        (line) => line.kind === 'category' && line.spent !== 0,
      )
    : [];

  return (
    <Screen>
      <Title>Bank link</Title>
      <Body>
        Sandbox is free and cannot write this household. Trial uses your banks, up to 10 Items for the team. Paid
        Production waits.
      </Body>
      <Meta>
        {linked} of {BANK_INSTITUTION_CAP} institutions on the plan. Sidecar {sidecarUrl()}.
      </Meta>
      <Meta>{status}</Meta>
      {updateItem ? null : (
        <Card>
          <Body>
            Linking a bank opens Plaid. Their end-user privacy policy explains what they receive. This app keeps the
            link on this phone.
          </Body>
          <Button
            label="Plaid privacy policy"
            tone="ghost"
            onPress={() => void Linking.openURL('https://plaid.com/legal/#end-user-privacy-policy')}
          />
          <Button
            label={plaidConsent ? 'Ready to link' : 'I have read that policy'}
            tone={plaidConsent ? 'accent' : 'ghost'}
            onPress={() => setPlaidConsent(true)}
          />
        </Card>
      )}
      <Button
        label={updateItem ? 'Refresh this institution' : 'Link a bank'}
        disabled={!updateItem && !plaidConsent}
        onPress={() => void link()}
      />
      {(household?.plaidItems ?? []).map((item) => (
        <Card key={item.itemId}>
          <Body>{item.institutionName ?? 'Linked bank'}</Body>
          <Button
            label="Disconnect"
            tone="danger"
            onPress={() => {
              confirm('Disconnect this bank?', 'The books stay. The link does not.', () => {
              void disconnectInstitution(item.itemId).then((result) => {
                const current = readHousehold();
                if (!current) return;
                setHousehold(forgetPlaidItem(current, item.itemId));
                setStatus(
                  result === 'removed'
                    ? 'Disconnected. Your books are still here.'
                    : 'Removed on this phone. The bank token could not be reached.',
                );
              });
              });
            }}
          />
        </Card>
      ))}
      <Meta>Simulate an outlier. This path still writes the real household when no keys are set.</Meta>
      <TextInput value={merchant} onChangeText={setMerchant} style={field} />
      <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" style={field} />
      <Button
        label="Ingest sandbox purchase"
        onPress={() => {
          if (!household) return;
          const value = parseMoney(amount);
          if (value == null) {
            setStatus('Amount has to be a positive number.');
            return;
          }
          const id = `sim-${Date.now()}`;
          updateHousehold((current) => ingestSimulatedOutlier(current, { id, merchant, amount: value }));
          const outlier = isOutlier({ id, amount: value, merchant, date: new Date().toISOString() }, 200, [1600, 8500, 14000]);
          const gate = notificationAllowed({
            lastNotificationAt: settings.lastNotificationAt,
            allClearCount: settings.allClearCount,
            hasOutlier: outlier,
          });
          if (gate.send && settings.notificationMode !== 'off') {
            patchSettings({
              lastNotificationAt: new Date().toISOString(),
              allClearCount: gate.kind === 'all_clear' ? settings.allClearCount + 1 : settings.allClearCount,
            });
          }
          setStatus(
            outlier
              ? `$${amount} ${merchant} is in the budget inbox. It is not a second living expense.`
              : 'Stored on the budget.',
          );
        }}
      />
      {sandboxLines.length ? (
        <Card>
          <Meta>Sandbox month (not your books)</Meta>
          {sandboxLines.map((line) => (
            <Meta key={line.id}>
              {line.name} spent {formatUsd(line.spent)}
            </Meta>
          ))}
        </Card>
      ) : null}
      {household ? (
        <Card>
          <Meta>Household intact: {household.accounts.length} accounts.</Meta>
        </Card>
      ) : null}
    </Screen>
  );
}
