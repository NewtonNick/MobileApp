import { StyleSheet, Text, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/ui/appearance';

function TabIcon({
  color,
  ios,
  android,
}: {
  color: ColorValue;
  ios: 'dollarsign.circle' | 'chart.line.uptrend.xyaxis' | 'shield' | 'chart.pie' | 'ellipsis';
  android: 'account_balance_wallet' | 'trending_up' | 'shield' | 'pie_chart' | 'more_horiz';
}) {
  return <SymbolView name={{ ios, android, web: android }} tintColor={color} size={22} />;
}

export default function TabsLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tabPad = Math.max(insets.bottom, 8);
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600', fontSize: 17, color: colors.text },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: 6,
          paddingBottom: tabPad,
        },
        tabBarLabel: ({ children, color }) => (
          <Text maxFontSizeMultiplier={1.3} style={{ color, fontSize: 11, fontWeight: '600', marginTop: 2 }}>
            {children}
          </Text>
        ),
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Cash',
          tabBarIcon: ({ color }) => <TabIcon color={color} ios="dollarsign.circle" android="account_balance_wallet" />,
        }}
      />
      <Tabs.Screen
        name="forecast"
        options={{
          title: 'Forecast',
          tabBarIcon: ({ color }) => (
            <TabIcon color={color} ios="chart.line.uptrend.xyaxis" android="trending_up" />
          ),
        }}
      />
      <Tabs.Screen
        name="risk"
        options={{
          title: 'Risk',
          tabBarIcon: ({ color }) => <TabIcon color={color} ios="shield" android="shield" />,
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: 'Budget',
          tabBarIcon: ({ color }) => <TabIcon color={color} ios="chart.pie" android="pie_chart" />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color }) => <TabIcon color={color} ios="ellipsis" android="more_horiz" />,
        }}
      />
    </Tabs>
  );
}
