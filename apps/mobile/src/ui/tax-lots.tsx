import { useEffect, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import {
  applyTaxLotSale,
  formatUsd,
  localIsoDate,
  lotsMarketValue,
  openLots,
  parseIsoDate,
  parseMoney,
  parsePercentInput,
  quoteTaxLotSale,
  pickLotSale,
  type AccountInput,
  type HouseholdInput,
  type LotMethod,
  type TaxLot,
} from '@asset-aware/forecast-engine';
import { NotAdviceNote } from '@/ui/not-advice-note';
import { Body, Button, Card, Meta, useFieldStyle } from '@/ui/primitives';
import { PercentField } from '@/ui/percent-field';

/**
 * Lots on one brokerage. The price is typed. The quote uses that price, the basis,
 * the acquisition date, and the rates on the household.
 */
export function TaxLots({
  books,
  account,
  onChange,
}: {
  books: HouseholdInput;
  account: AccountInput;
  onChange: (next: HouseholdInput) => void;
}) {
  const field = useFieldStyle();
  const lots = (books.taxLots ?? []).filter((lot) => lot.accountId === account.id);
  const asOf = localIsoDate();
  const opened = openLots(lots, asOf);
  const market = lotsMarketValue(lots);
  const matches = lots.length > 0 && Math.abs(market - account.balance) <= 1;
  const [shortRate, setShortRate] = useState(books.shortTermGainRate == null ? '' : String(books.shortTermGainRate * 100));
  const [longRate, setLongRate] = useState(books.longTermGainRate == null ? '' : String(books.longTermGainRate * 100));
  const [sellShares, setSellShares] = useState<Record<string, string>>({});
  const [symbol, setSymbol] = useState('');
  const [acquired, setAcquired] = useState('');
  const [shares, setShares] = useState('');
  const [basis, setBasis] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<LotMethod>('fifo');
  const [methodSymbol, setMethodSymbol] = useState('');
  const [methodShares, setMethodShares] = useState('');

  useEffect(() => {
    setShortRate(books.shortTermGainRate == null ? '' : String(books.shortTermGainRate * 100));
    setLongRate(books.longTermGainRate == null ? '' : String(books.longTermGainRate * 100));
  }, [books.shortTermGainRate, books.longTermGainRate]);

  if (account.type !== 'brokerage') return null;

  const saveRates = () => {
    const short = shortRate.trim() ? parsePercentInput(shortRate) : null;
    const long = longRate.trim() ? parsePercentInput(longRate) : null;
    if (shortRate.trim() && short == null) {
      setError('Confirm the short-term rate before saving.');
      return;
    }
    if (longRate.trim() && long == null) {
      setError('Confirm the long-term rate before saving.');
      return;
    }
    setError(null);
    onChange({ ...books, shortTermGainRate: short, longTermGainRate: long });
  };

  const addLot = () => {
    const parsedShares = parseMoney(shares);
    const parsedBasis = parseMoney(basis);
    const parsedPrice = parseMoney(price);
    if (!/^[A-Za-z][A-Za-z0-9.\-]{0,11}$/.test(symbol.trim())) {
      setError('Use a symbol like VTI.');
      return;
    }
    if (!parseIsoDate(acquired.trim())) {
      setError('Use an acquisition date like 2020-03-15.');
      return;
    }
    if (parsedShares == null || !(parsedShares > 0) || parsedBasis == null || parsedPrice == null || !(parsedPrice > 0)) {
      setError('Shares, cost basis, and price have to be numbers. Price and shares have to be above zero.');
      return;
    }
    if (acquired.trim() > asOf) {
      setError('The acquisition date is still in the future.');
      return;
    }
    const next: TaxLot = {
      id: `lot-${Date.now()}`,
      accountId: account.id,
      symbol: symbol.trim().toUpperCase(),
      acquiredOn: acquired.trim(),
      shares: parsedShares,
      costBasis: parsedBasis,
      pricePerShare: parsedPrice,
    };
    setError(null);
    setSymbol('');
    setAcquired('');
    setShares('');
    setBasis('');
    setPrice('');
    onChange({ ...books, taxLots: [...(books.taxLots ?? []), next] });
  };

  const lines = opened.flatMap((row) => {
    const raw = sellShares[row.lot.id] ?? String(row.lot.shares);
    const count = raw.trim() ? parseMoney(raw) : 0;
    if (count == null || !(count > 0)) return [];
    return [{ lotId: row.lot.id, shares: count }];
  });
  const quoted = lines.length
    ? quoteTaxLotSale(books.taxLots ?? [], lines, { shortTerm: books.shortTermGainRate ?? null, longTerm: books.longTermGainRate ?? null }, asOf)
    : null;

  const record = () => {
    if (!quoted || !quoted.ok || quoted.value.afterTaxProceeds == null) return;
    const cash = formatUsd(quoted.value.afterTaxProceeds);
    Alert.alert('Record this sale?', `Cash increases by ${cash}. The shares leave the lot.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Record',
        onPress: () => {
          const sold = applyTaxLotSale(books, lines, asOf);
          if (!sold.ok) {
            setError(sold.error);
            return;
          }
          setSellShares({});
          setError(null);
          onChange(sold.value);
        },
      },
    ]);
  };

  const fillByMethod = () => {
    const count = parseMoney(methodShares);
    const ticker = methodSymbol.trim().toUpperCase();
    if (!ticker || count == null) {
      setError('Enter a symbol and a share count.');
      return;
    }
    const picked = pickLotSale(books.taxLots ?? [], ticker, count, method);
    if (!picked.length) {
      setError('No open lots for that symbol.');
      return;
    }
    const next: Record<string, string> = {};
    for (const row of opened) next[row.lot.id] = '0';
    for (const line of picked) next[line.lotId] = String(line.shares);
    setSellShares(next);
    setError(null);
  };

  return (
    <Card>
      <Body>Tax lots</Body>
      <NotAdviceNote extra="Federal tax only. This quote does not apply wash sales, the net investment income tax, or state tax." />
      <Meta>
        Price is the number you type. These rates apply to every brokerage in the household. A lot held more than a
        year is long-term. The quote uses your basis, your date, and your rates. It does not apply wash sales, state
        tax, or the 3.8% investment-income tax. A loss can reduce other income by up to $3,000. That savings is not
        added to the sale cash. A withdrawal more than a year from now is taxed at the long-term rate. The next 12
        months keep today&apos;s split, and growth this year stays short-term.
      </Meta>
      <PercentField label="Short-term gain rate" value={shortRate} onChangeText={setShortRate} />
      <PercentField label="Long-term gain rate" value={longRate} onChangeText={setLongRate} />
      <Button label="Save rates" tone="ghost" onPress={saveRates} />

      <Meta>Sell across lots of one symbol</Meta>
      <TextInput accessibilityLabel="Symbol to sell" value={methodSymbol} onChangeText={setMethodSymbol} autoCapitalize="characters" style={field} />
      <TextInput accessibilityLabel="Shares to sell across lots" value={methodShares} onChangeText={setMethodShares} keyboardType="decimal-pad" style={field} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Oldest first" tone={method === 'fifo' ? 'accent' : 'ghost'} onPress={() => setMethod('fifo')} />
        <Button label="Highest basis first" tone={method === 'hifo' ? 'accent' : 'ghost'} onPress={() => setMethod('hifo')} />
      </View>
      <Button label="Fill those shares" tone="ghost" onPress={fillByMethod} />

      {lots.length ? (
        matches ? (
          <Meta>These lots match the balance, so a withdrawal on the hired date uses this gain.</Meta>
        ) : (
          <>
            <Meta>
              Lots are worth {formatUsd(market)}. The balance is {formatUsd(account.balance)}. The hired date does not
              tax the rest of the account until those match.
            </Meta>
            <Button
              label="Set the balance from these lots"
              tone="ghost"
              onPress={() =>
                onChange({
                  ...books,
                  accounts: books.accounts.map((row) =>
                    row.id === account.id ? { ...row, balance: market, lastEditedAt: new Date().toISOString() } : row,
                  ),
                })
              }
            />
          </>
        )
      ) : (
        <Meta>No lots yet. The balance still grows at the expected return, with no gain tax.</Meta>
      )}

      {opened.map((row) => (
        <View key={row.lot.id} style={{ gap: 6 }}>
          <Body>
            {row.lot.symbol} · {row.term === 'long' ? 'Long-term' : 'Short-term'}
          </Body>
          <Meta>
            {row.lot.shares} shares acquired {row.lot.acquiredOn}. Basis {formatUsd(row.lot.costBasis)}. Worth{' '}
            {formatUsd(row.marketValue)}. Gain {formatUsd(row.gain)}.
          </Meta>
          <Meta>Shares to sell</Meta>
          <TextInput
            accessibilityLabel={`Shares to sell of ${row.lot.symbol}`}
            value={sellShares[row.lot.id] ?? String(row.lot.shares)}
            onChangeText={(next) => setSellShares((prev) => ({ ...prev, [row.lot.id]: next }))}
            keyboardType="decimal-pad"
            style={field}
          />
          <Button
            label="Remove lot"
            tone="ghost"
            onPress={() =>
              Alert.alert('Remove this lot?', row.lot.symbol, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => onChange({ ...books, taxLots: (books.taxLots ?? []).filter((lot) => lot.id !== row.lot.id) }),
                },
              ])
            }
          />
        </View>
      ))}

      {quoted && !quoted.ok ? <Meta>{quoted.error}</Meta> : null}
      {quoted && quoted.ok ? (
        <>
          <Meta>
            If sold today: proceeds {formatUsd(quoted.value.proceeds)}, gain {formatUsd(quoted.value.shortGain + quoted.value.longGain)}
            {quoted.value.tax == null ? '. Tax is not priced until both rates are set.' : `, tax ${formatUsd(quoted.value.tax)}, cash ${formatUsd(quoted.value.afterTaxProceeds ?? 0)}.`}
          </Meta>
          {quoted.value.ordinaryDeduction > 0 ? (
            <Meta>
              Up to {formatUsd(quoted.value.ordinaryDeduction)} of this loss can reduce other income this year.
              {quoted.value.carryforward > 0 ? ` ${formatUsd(quoted.value.carryforward)} carries forward.` : ''}
            </Meta>
          ) : null}
          {quoted.value.afterTaxProceeds != null ? <Button label="Record this sale" onPress={record} /> : null}
        </>
      ) : null}

      <Meta>Symbol</Meta>
      <TextInput accessibilityLabel="Lot symbol" value={symbol} onChangeText={setSymbol} autoCapitalize="characters" style={field} />
      <Meta>Acquired on</Meta>
      <TextInput accessibilityLabel="Acquired on" value={acquired} onChangeText={setAcquired} placeholder="2020-03-15" style={field} />
      <Meta>Shares</Meta>
      <TextInput accessibilityLabel="Shares" value={shares} onChangeText={setShares} keyboardType="decimal-pad" style={field} />
      <Meta>Cost basis</Meta>
      <TextInput accessibilityLabel="Cost basis" value={basis} onChangeText={setBasis} keyboardType="decimal-pad" style={field} />
      <Meta>Price per share</Meta>
      <TextInput accessibilityLabel="Price per share" value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={field} />
      <Button label="Add lot" onPress={addLot} />
      {error ? <Meta>{error}</Meta> : null}
    </Card>
  );
}
