import { Children, useMemo, type ReactNode, type RefObject } from 'react';
import {
  KeyboardAvoidingView,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, type Palette } from '@/lib/theme';
import { useColors } from '@/ui/appearance';

function useUiStyles() {
  const colors = useColors();
  return useMemo(() => createStyles(colors), [colors]);
}

export function useFieldStyle() {
  const field = useUiStyles().field;
  const scale = Math.min(PixelRatio.getFontScale(), 1.6);
  return [field, { minHeight: Math.round(48 * scale) }];
}

export function KeyboardForm({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

export function Screen({
  children,
  style,
  scroll = true,
  scrollRef,
  ...rest
}: ViewProps & { scroll?: boolean; scrollRef?: RefObject<ScrollView | null> }) {
  const styles = useUiStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const headerHeight = Platform.OS === 'ios' ? insets.top + 56 : 0;
  const { width } = useWindowDimensions();
  const frame = {
    flex: 1,
    width: '100%' as const,
    maxWidth: width >= 720 ? 720 : undefined,
    alignSelf: 'center' as const,
    backgroundColor: colors.bg,
  };
  const padBottom = Math.max(insets.bottom, 12) + space.lg;
  return (
    <KeyboardAvoidingView
      style={frame}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}>
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.screen, { paddingBottom: padBottom }, style]}
          {...rest}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screen, { flex: 1, paddingBottom: insets.bottom }, style]} {...rest}>
          {children}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

export function Title({ children, style, ...rest }: TextProps) {
  const styles = useUiStyles();
  return (
    <Text style={[styles.title, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Headline({ children, style, ...rest }: TextProps) {
  const styles = useUiStyles();
  return (
    <Text style={[styles.headline, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Body({ children, style, ...rest }: TextProps) {
  const styles = useUiStyles();
  return (
    <Text style={[styles.body, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Meta({ children, style, ...rest }: TextProps) {
  const styles = useUiStyles();
  return (
    <Text style={[styles.meta, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Kicker({ children, style, ...rest }: TextProps) {
  const styles = useUiStyles();
  return (
    <Text style={[styles.kicker, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Amount({ children, style, ...rest }: TextProps) {
  const styles = useUiStyles();
  return (
    <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.amount, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Card({ children, style, ...rest }: ViewProps) {
  const styles = useUiStyles();
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

export function Banner({
  children,
  tone = 'warn',
}: {
  children: ReactNode;
  tone?: 'warn' | 'good' | 'danger';
}) {
  const colors = useColors();
  const styles = useUiStyles();
  const background =
    tone === 'good' ? colors.goodSoft : tone === 'danger' ? colors.dangerSoft : colors.warnSoft;
  const color = tone === 'good' ? colors.good : tone === 'danger' ? colors.danger : colors.preview;
  return (
    <View style={[styles.banner, { backgroundColor: background }]}>
      <Text style={[styles.bannerText, { color }]}>{children}</Text>
    </View>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  const styles = useUiStyles();
  const w = Math.max(0, Math.min(100, percent));
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: w }}>
      <View style={[styles.fill, { width: `${w}%` }]} />
    </View>
  );
}

export function Button({
  label,
  tone = 'accent',
  style,
  numberOfLines,
  ...rest
}: PressableProps & { label: string; tone?: 'accent' | 'ghost' | 'danger' | 'quiet'; numberOfLines?: number }) {
  const styles = useUiStyles();
  const lightLabel = tone === 'accent' || tone === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      style={(state) => [
        styles.btn,
        styles.pointer,
        tone === 'ghost' && styles.btnGhost,
        tone === 'danger' && styles.btnDanger,
        tone === 'quiet' && styles.btnQuiet,
        rest.disabled && styles.btnDisabled,
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      <Text
        numberOfLines={numberOfLines}
        style={[styles.btnText, !lightLabel && styles.btnTextAccent, tone === 'quiet' && styles.btnTextQuiet]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FormField({
  label,
  hint,
  error,
  onChange,
  ...props
}: Omit<TextInputProps, 'onChange' | 'onChangeText'> & {
  label: string;
  hint?: string;
  error?: string;
  onChange?: (value: string) => void;
  onChangeText?: (value: string) => void;
}) {
  const colors = useColors();
  const styles = useUiStyles();
  const scale = Math.min(PixelRatio.getFontScale(), 1.6);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.meta}>{label}</Text>
      {hint ? <Text style={[styles.body, { fontSize: 14, lineHeight: 20, color: colors.muted }]}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor={colors.muted}
        keyboardType={props.keyboardType}
        {...props}
        onChangeText={onChange ?? props.onChangeText}
        style={[styles.field, { minHeight: Math.round(48 * scale) }, props.style]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={[styles.meta, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Field(props: TextInputProps) {
  const colors = useColors();
  const styles = useUiStyles();
  return <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.field, props.style]} />;
}

export function ListGroup({ children, style, ...rest }: ViewProps) {
  const styles = useUiStyles();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.group, style]} {...rest}>
      {rows.map((row, index) => (
        <View key={index} style={index > 0 ? styles.rowDivider : undefined}>
          {row}
        </View>
      ))}
    </View>
  );
}

export function ListRow({
  label,
  detail,
  onPress,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
}) {
  const styles = useUiStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.pointer, pressed && styles.rowPressed]}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail ? <Text style={styles.meta}>{detail}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export function SelectCard({
  selected,
  title,
  detail,
  onPress,
  children,
}: {
  selected?: boolean;
  title: string;
  detail?: string;
  onPress: () => void;
  children?: ReactNode;
}) {
  const colors = useColors();
  const styles = useUiStyles();
  return (
    <View style={[styles.select, selected && styles.selectOn]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: !!selected }}
        onPress={onPress}
        style={({ pressed }) => [styles.selectHead, pressed && styles.pressed]}>
        <View style={[styles.mark, selected && styles.markOn]} />
        <View style={styles.rowCopy}>
          <Text style={styles.headline}>{title}</Text>
          {detail ? <Text style={[styles.meta, selected && { color: colors.text }]}>{detail}</Text> : null}
        </View>
      </Pressable>
      {children}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const styles = useUiStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, styles.pointer, selected && styles.chipOn, pressed && styles.pressed]}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

export function Hairline() {
  const styles = useUiStyles();
  return <View style={styles.hairline} />;
}

export const scrollContent = {
  gap: space.md,
  paddingBottom: space.xxl,
};

function createStyles(colors: Palette) {
  const cardShadow = Platform.select({
    ios: {
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: colors.shadowOpacity,
      shadowRadius: 18,
    },
    android: { elevation: 2 },
    default: { boxShadow: colors.boxShadow },
  });
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
    paddingTop: space.sm,
    gap: space.md,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.text,
  },
  headline: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
  },
  body: {
    fontSize: 16,
    lineHeight: 23,
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  kicker: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  amount: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
    ...cardShadow,
  },
  banner: {
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  btn: {
    minHeight: 48,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  btnGhost: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  btnDanger: {
    backgroundColor: colors.danger,
  },
  btnQuiet: {
    backgroundColor: 'transparent',
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 0,
    alignItems: 'flex-start',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.82,
  },
  btnText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: '600',
  },
  btnTextAccent: {
    color: colors.accent,
  },
  btnTextQuiet: {
    fontSize: 15,
  },
  field: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.text,
  },
  track: {
    height: 8,
    width: '100%',
    backgroundColor: colors.bgMuted,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...cardShadow,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  rowPressed: {
    backgroundColor: colors.bgMuted,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    color: colors.text,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 22,
    color: colors.muted,
  },
  select: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: space.md,
    gap: space.sm,
    ...cardShadow,
  },
  selectOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  selectHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
  },
  mark: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  markOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgMuted,
  },
  chipOn: {
    backgroundColor: colors.accent,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  chipLabelOn: {
    color: colors.accentText,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },
  pointer: Platform.OS === 'web' ? { cursor: 'pointer' } : {},
  });
}
