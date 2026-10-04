import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Share, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';

import {
  applyLiquidTotal,
  assessSecurity,
  findDuplicateGuesses,
  findOwnershipDuplicateGuesses,
  dismissDuplicateGuess,
  linkDuplicateBills,
  linkOwnershipExpense,
  mortgageEscrowOverlap,
  formatMoneyDraft,
  formatUsd,
  householdHasIncome,
  householdWarnings,
  staleAssetPrompts,
  isLiquid,
  liquidSum,
  parseMoney,
  cashLastEdited,
  figuresToRetype,
  isCashStale,
  linkIsCurrent,
  monthKey,
  showCollisionAsk,
  showReturn,
  livingBriefing,
  nextBest,
  pulseBody,
  removeOpenGoal,
  setEmergencyBuffer,
} from '@asset-aware/forecast-engine';
import { seedBundle } from '@/lib/seed';
import { daysSince } from '@/state/household';
import { useForecasts, useHousehold } from '@/state/context';
import {
  Amount,
  Banner,
  Body,
  Button,
  Card,
  Chip,
  Field,
  Headline,
  Kicker,
  Meta,
  ProgressBar,
  Screen,
} from '@/ui/primitives';
import { DuplicateGuessCard } from '@/ui/duplicate-guess-card';
import { Completeness, LooksWrong, SourceLine } from '@/ui/money';
import { ScenarioControl } from '@/ui/scenario-control';
import { maybeNotify, reminderLabel, scheduleBackupReminder } from '@/notifications';
import { useColors } from '@/ui/appearance';

export default function CashHome() {
  const colors = useColors();
  const router = useRouter();
  const { household, settings, standingView, goalBoard, setHousehold, updateHousehold, patchSettings } = useHousehold();
  const results = useForecasts();
  const [cashDraft, setCashDraft] = useState(() =>
    household ? formatMoneyDraft(liquidSum(household)) : '',
  );
  const [cashError, setCashError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [remindNote, setRemindNote] = useState<string | null>(null);

  useEffect(() => {
    if (!household || !standingView) return;
    const now = new Date();
    const month = monthKey(now);
    const returning =
      !!standingView.hiredDate &&
      showReturn(household, standingView.hiredDate, isCashStale(household, now.getTime()), now) &&
      settings.lastReturnNudgeMonth !== month;
    if (returning) {
      const edited = cashLastEdited(household);
      const when = edited ? new Date(edited).toLocaleDateString() : 'before this month';
      void maybeNotify(
        settings,
        `Last edited ${when}. ${figuresToRetype(household)} figures to retype before the date is current.`,
        true,
      ).then((patch) => {
        if (patch.lastNotificationAt) patchSettings({ ...patch, lastReturnNudgeMonth: month });
      });
      return;
    }
    const reason = standingView.pulseReasons.find((r) => r.kind === 'stale_cash');
    if (!reason || reason.kind !== 'stale_cash') return;
    void maybeNotify(
      settings,
      pulseBody(household.jobClass, `Cash may be stale · ${reason.days} days ago.`),
      true,
    ).then((patch) => {
      if (Object.keys(patch).length) patchSettings(patch);
    });
  }, [household, standingView, settings, patchSettings]);

  if (!household || !results || !standingView) {
    return (
      <Screen>
        <Kicker>Cash</Kicker>
        <Headline>No household yet</Headline>
        <Body>Start with the dates this household is aiming at.</Body>
        <Button label="Start" onPress={() => router.replace('/job-pick' as Href)} />
      </Screen>
    );
  }

  const view = results[settings.scenario];
  const cashDays = daysSince(view.cashLastEditedAt);
  const preview = household.kind === 'preview';
  const stale = standingView.pulseReasons.find((r) => r.kind === 'stale_cash');
  const lastEdited = standingView.pulseReasons.find((r) => r.kind === 'last_edited');
  const leftoverClaimed = standingView.leftover === 0 || standingView.collisionMonth != null;
  const seedStale = standingView.pulseReasons.find((r) => r.kind === 'stale_seed') || results.seedStale;
  const probe = nextBest(household);
  const briefing = livingBriefing(standingView, probe);
  const missingIncome = !householdHasIncome(household);
  const security = assessSecurity(household, seedBundle, settings.scenario);
  const securityColor =
    security.band === 'secure'
      ? colors.good
      : security.band === 'fragile'
        ? colors.danger
        : security.band === 'exposed'
          ? colors.preview
          : colors.accent;

  const applyCash = (raw: string) => {
    const n = parseMoney(raw);
    if (n == null) {
      setCashError('Cash has to be a number, like 4200 or $4,200.');
      return;
    }
    setCashError(null);
    setCashDraft(formatMoneyDraft(n));
    updateHousehold((current) => applyLiquidTotal(current, n));
  };

  const shareSentence = async () => {
    const sentence = standingView?.sentence;
    if (!sentence) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sentence);
        setShareNote('Copied.');
        return;
      }
      await Share.share({ message: sentence });
    } catch {
      setShareNote('Could not share that sentence.');
    }
  };

  const remindTonight = async () => {
    const scheduled = await scheduleBackupReminder(settings);
    if (!scheduled.ok) {
      setRemindNote(scheduled.message);
      return;
    }
    patchSettings({ backupReminderAt: scheduled.at, backupReminderId: scheduled.id });
    setRemindNote(reminderLabel(scheduled.at));
  };

  const markRealized = () => {
    const key = standingView.collisionKey;
    if (!key || household.realizedEventKeys.includes(key)) return;
    setHousehold({ ...household, realizedEventKeys: [...household.realizedEventKeys, key] });
    if (showCollisionAsk(household, true)) patchSettings({ collisionBankAsk: true });
  };
  const bankCurrent = linkIsCurrent(household.plaidItems);
  const returnAsk = showReturn(
    household,
    standingView.hiredDate,
    isCashStale(household),
  );
  const collisionAsk =
    !bankCurrent && (settings.collisionBankAsk || showCollisionAsk(household, standingView.collisionKey != null));
  const editedAt = cashLastEdited(household);

  const focusGoal = (card: (typeof goalBoard)[number]) => {
    setHousehold({
      ...household,
      jobClass: card.jobClass,
      goalSpec: card.spec.source === 'custom' ? card.spec : household.goalSpec,
    });
  };
  const guesses = findDuplicateGuesses(household.expenses, household.accounts);
  const ownershipGuesses = findOwnershipDuplicateGuesses(household.expenses, household.assets);
  const escrowOverlap = mortgageEscrowOverlap(household.accounts, household.assets);
  const bookWarnings = householdWarnings(household);
  const staleAssets = staleAssetPrompts(household);

  const securitySoft =
    security.band === 'secure'
      ? colors.goodSoft
      : security.band === 'fragile'
        ? colors.dangerSoft
        : security.band === 'exposed'
          ? colors.warnSoft
          : colors.accentSoft;

  return (
    <Screen>
        {preview ? <Banner>Preview. These are sample books, not yours.</Banner> : null}
        {bookWarnings.map((line) => (
          <Banner key={line}>{line}</Banner>
        ))}
        {staleAssets.map((prompt) => (
          <Banner key={prompt.assetId}>
            {prompt.message}
            <Button
              label="Remove"
              tone="quiet"
              onPress={() =>
                Alert.alert('Remove this asset?', prompt.name, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () =>
                      setHousehold({
                        ...household,
                        assets: household.assets.filter((row) => row.id !== prompt.assetId),
                      }),
                  },
                ])
              }
            />
          </Banner>
        ))}
        <View style={{ gap: 6 }}>
          <Kicker>Free cash</Kicker>
          <Amount>{formatUsd(standingView.leftover)}</Amount>
          <Meta>
            {standingView.reservedLabel} {formatUsd(standingView.reserved)}
          </Meta>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${security.title}, ${security.score}. Open repair chances.`}
            onPress={() => router.push('/(tabs)/risk')}
            hitSlop={8}
            style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', backgroundColor: securitySoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Meta style={{ color: securityColor, fontWeight: '700' }}>
              {security.title} · {security.score}
            </Meta>
          </Pressable>
          <Button label="Share this sentence" tone="quiet" onPress={() => void shareSentence()} />
          {shareNote ? <Meta>{shareNote}</Meta> : null}
        </View>

        <ScenarioControl value={settings.scenario} onChange={(s) => patchSettings({ scenario: s })} />

        {missingIncome ? (
          <Card>
            <Body>
              Add take-home pay. Without it this plan cannot date leftover, debt payoff, or Retire early — the
              rest of the app is a guess.
            </Body>
            <Button label="Add take-home pay" onPress={() => router.push('/onboarding' as Href)} />
          </Card>
        ) : null}

        <Kicker>Goals</Kicker>
        {!goalBoard.length ? (
          <Card>
            <Body>No goals elected yet. Pick the dates this household is actually aiming at.</Body>
            <Button label="Choose goals" onPress={() => router.push('/job-pick' as Href)} />
          </Card>
        ) : (
          goalBoard.map((card) => (
            <Card key={card.spec.id}>
              <Headline>{card.spec.name}</Headline>
              <Body style={{ fontWeight: '600' }}>{card.headline}</Body>
              {card.percent != null ? <ProgressBar percent={card.percent} /> : null}
              {card.current != null && card.target != null && card.target > 0 ? (
                <Meta>
                  {formatUsd(card.current)} of {formatUsd(card.target)}
                  {card.percent != null ? ` · ${card.percent}%` : ''}
                </Meta>
              ) : card.current != null && card.spec.target.kind === 'debt_zero' ? (
                <Meta>{formatUsd(card.current)} left</Meta>
              ) : (
                <Meta>
                  {formatUsd(card.view.reserved)} reserved · {formatUsd(card.view.leftover)} free
                </Meta>
              )}
              <Meta>{card.view.sentence}</Meta>
              <Button
                tone="quiet"
                label={
                  household.jobClass === card.jobClass
                    ? 'Featured on Forecast'
                    : 'Feature this goal'
                }
                onPress={() => focusGoal(card)}
              />
              {card.spec.id === 'preset:cash_buffer' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip
                    selected={!(card.spec.target.kind === 'runway' && card.spec.target.months === 6)}
                    label="3 months"
                    onPress={() => updateHousehold((current) => setEmergencyBuffer(current, 3))}
                  />
                  <Chip
                    selected={card.spec.target.kind === 'runway' && card.spec.target.months === 6}
                    label="6 months"
                    onPress={() => updateHousehold((current) => setEmergencyBuffer(current, 6))}
                  />
                </View>
              ) : null}
              {card.spec.source === 'custom' ? (
                <>
                  <Button
                    tone="quiet"
                    label="Edit"
                    onPress={() => router.push({ pathname: '/custom-goal', params: { id: card.spec.id } } as Href)}
                  />
                  <Button
                    tone="quiet"
                    label="Remove"
                    onPress={() =>
                      Alert.alert('Remove this goal?', card.spec.name, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => updateHousehold((current) => removeOpenGoal(current, card.spec.id)),
                        },
                      ])
                    }
                  />
                </>
              ) : null}
            </Card>
          ))
        )}

        <Button label="Add or change goals" tone="ghost" onPress={() => router.push('/job-pick' as Href)} />

        <Kicker>Where you stand</Kicker>
        <Card>
          <Kicker>Trail</Kicker>
          <Body>{briefing.trail}</Body>
          <Kicker>Exit</Kicker>
          <Body>{briefing.exit}</Body>
          {briefing.turnaround ? (
            <>
              <Kicker>Turnaround</Kicker>
              <Body>{briefing.turnaround}</Body>
            </>
          ) : null}
          {briefing.probes ? (
            <>
              <Kicker>Next probe</Kicker>
              <Body>{briefing.probes}</Body>
            </>
          ) : null}
        </Card>

        {leftoverClaimed ? (
          <Card>
            <Body>
              Free cash is already spoken for
              {standingView.collisionLabel ? ` — ${standingView.collisionLabel}` : ''}.
            </Body>
          </Card>
        ) : null}

        <Card>
          <Kicker>Cash on hand</Kicker>
          <Meta>Checking and savings, combined</Meta>
          {household.accounts.filter((account) => isLiquid(account.type)).map((account) => (
            <Meta key={account.id}>
              {account.name} · {formatUsd(account.balance)}
            </Meta>
          ))}
          <Field
            accessibilityLabel="Cash on hand, checking and savings combined"
            value={cashDraft}
            onChangeText={(next) => {
              setCashError(null);
              setCashDraft(next);
            }}
            onEndEditing={() => applyCash(cashDraft)}
            keyboardType="decimal-pad"
          />
          {cashError ? <Meta>{cashError}</Meta> : null}
          <Button label="Update cash" onPress={() => applyCash(cashDraft)} />
          <LooksWrong onPress={() => router.push('/looks-wrong')} />
          <SourceLine result={view} />
        </Card>

        {stale ? <Meta>Cash may be stale · {stale.days} days ago. Standing is based on older cash.</Meta> : null}
        {lastEdited && lastEdited.kind === 'last_edited' ? (
          <Meta>Cash · {daysSince(lastEdited.at) ?? 0} days ago</Meta>
        ) : cashDays != null ? (
          <Meta>Cash · {cashDays} days ago</Meta>
        ) : null}

        {guesses[0] ? (
          <DuplicateGuessCard
            guess={guesses[0]}
            onSame={() => updateHousehold((current) => linkDuplicateBills(current, guesses[0]))}
            onUnsure={() => updateHousehold((current) => dismissDuplicateGuess(current, guesses[0]))}
          />
        ) : ownershipGuesses[0] ? (
          <Card>
            <Body>
              {ownershipGuesses[0].expenseName} looks like {ownershipGuesses[0].lineLabel.toLowerCase()}. Count it once?
            </Body>
            <Button
              label="Same bill"
              onPress={() => updateHousehold((current) => linkOwnershipExpense(current, ownershipGuesses[0]))}
            />
          </Card>
        ) : escrowOverlap ? (
          <Card>
            <Body>
              {escrowOverlap.mortgageName} has escrow, and the house also has tax or insurance. Escrow usually already
              includes those.
            </Body>
            <Button
              label="Escrow covers tax and insurance"
              onPress={() =>
                setHousehold({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === escrowOverlap.mortgageId ? { ...account, escrowCoversHousing: true } : account,
                  ),
                })
              }
            />
            <Button
              label="They are separate"
              tone="ghost"
              onPress={() =>
                setHousehold({
                  ...household,
                  accounts: household.accounts.map((account) =>
                    account.id === escrowOverlap.mortgageId ? { ...account, escrowCoversHousing: false } : account,
                  ),
                })
              }
            />
          </Card>
        ) : standingView.collisionKey ? (
          <Card>
            <Body>
              Mark {standingView.constraintLabel ?? standingView.collisionLabel} paid if you already replaced it. It
              drops out of reserved.
            </Body>
            <Button
              label={`I already paid ${standingView.constraintLabel ?? standingView.collisionLabel}`}
              onPress={markRealized}
            />
          </Card>
        ) : returnAsk ? (
          <Card>
            <Body>
              Last edited {editedAt ? new Date(editedAt).toLocaleDateString() : 'before this month'}.{' '}
              {figuresToRetype(household)} figures to retype before the date is current.
            </Body>
            <Button label="Add a spend" onPress={() => router.push('/spend' as Href)} />
            <Button
              label="Fill this month from the bank"
              tone="ghost"
              onPress={() => router.push('/paywall' as Href)}
            />
          </Card>
        ) : collisionAsk ? (
          <Card>
            <Body>The next charge like this will not show up until the bank is linked.</Body>
            <Button
              label="Fill this month from the bank"
              tone="ghost"
              onPress={() => router.push('/paywall' as Href)}
            />
          </Card>
        ) : view.nextQuestion ? (
          <Card>
            <Body>{view.nextQuestion}</Body>
            <Button label="Improve this plan" onPress={() => router.push('/improve' as Href)} />
          </Card>
        ) : !settings.lastBackupAt ? (
          <Card>
            <Body>Save a backup so a new phone does not wipe this.</Body>
            <Button label="Save backup" onPress={() => router.push('/backup')} />
            <Button label="Remind me tonight" tone="ghost" onPress={() => void remindTonight()} />
            {remindNote ? <Meta>{remindNote}</Meta> : null}
          </Card>
        ) : null}

        {seedStale ? <Meta>Cost tables may be outdated.</Meta> : null}

        <Completeness
          score={view.completeness}
          chip={view.confidenceChip}
          onPress={() => router.push('/improve' as Href)}
        />

        {preview ? (
          <Button label="Start with my household" onPress={() => router.replace('/job-pick' as Href)} />
        ) : null}
    </Screen>
  );
}
