import { Component, type ReactNode } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { lightColors } from '@/lib/theme';
import { formatCrashReport } from '@/ui/crash-report';

type Props = { children: ReactNode };
type State = { message: string | null; stack: string | null };

export class CrashBoundary extends Component<Props, State> {
  state: State = { message: null, stack: null };

  static getDerivedStateFromError(error: Error): State {
    return { message: error.message, stack: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    this.setState({ message: error.message, stack: info.componentStack ?? null });
  }

  render(): ReactNode {
    if (!this.state.message) return this.props.children;
    const report = formatCrashReport(this.state.message, this.state.stack);
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Something stopped this screen</Text>
        <Text style={styles.body}>The books were not erased. You can try the screen again, or send this note.</Text>
        <Text style={styles.report}>{report}</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => this.setState({ message: null, stack: null })}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.ghost}
          onPress={() => {
            void Share.share({ message: report });
          }}>
          <Text style={styles.ghostText}>Share this note</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: lightColors.bg,
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 16,
  },
  title: { color: lightColors.text, fontSize: 22, fontWeight: '600' },
  body: { color: lightColors.text, fontSize: 16, lineHeight: 22 },
  report: { color: lightColors.muted, fontSize: 13, lineHeight: 18 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: lightColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: lightColors.accentText, fontSize: 16, fontWeight: '600' },
  ghost: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: lightColors.accent, fontSize: 16 },
});
