export type ActionAppearance = 'ghost' | 'outline' | 'solid' | 'text';

export type IconButtonAppearance = Exclude<ActionAppearance, 'text'>;

export type ActionSize = 'large' | 'medium' | 'small';

export type ActionTone = 'accent' | 'critical' | 'neutral';
