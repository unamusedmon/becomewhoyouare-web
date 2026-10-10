import { View } from 'react-native';

import { colors } from './theme';

/**
 * A small gear drawn from plain Views, so it follows the theme without an icon font or SVG.
 * Four crossed bars make the eight teeth, a disc makes the body, and a background-coloured hole finishes it.
 */
export function GearIcon({ size = 20, color = colors.muted }: { size?: number; color?: string }) {
  const tooth = Math.round(size * 0.26);
  const body = Math.round(size * 0.72);
  const hole = Math.round(size * 0.3);
  const centre = (d: number) => ({ position: 'absolute' as const, left: (size - d) / 2, top: (size - d) / 2 });
  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={{
            position: 'absolute', left: 0, top: (size - tooth) / 2, width: size, height: tooth,
            borderRadius: 1, backgroundColor: color, transform: [{ rotate: `${deg}deg` }],
          }}
        />
      ))}
      <View style={[centre(body), { width: body, height: body, borderRadius: body / 2, backgroundColor: color }]} />
      <View style={[centre(hole), { width: hole, height: hole, borderRadius: hole / 2, backgroundColor: colors.bg }]} />
    </View>
  );
}
