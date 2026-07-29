/** My Vitalis Health — premium clinical palette (token-driven for white-label). */
const withAlpha = (v) => `hsl(var(${v}) / <alpha-value>)`;

module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        border: withAlpha('--border'),
        'border-soft': withAlpha('--border-soft'),
        input: withAlpha('--input'),
        ring: withAlpha('--ring'),
        background: withAlpha('--background'),
        foreground: withAlpha('--foreground'),
        soft: withAlpha('--soft'),
        faint: withAlpha('--faint'),
        primary: { DEFAULT: withAlpha('--primary'), foreground: withAlpha('--primary-foreground') },
        accent: { DEFAULT: withAlpha('--accent'), foreground: withAlpha('--accent-foreground'), soft: withAlpha('--accent-soft') },
        gold: { DEFAULT: withAlpha('--gold'), soft: withAlpha('--gold-soft') },
        ink: withAlpha('--ink'),
        panel: withAlpha('--panel'),
        muted: { DEFAULT: withAlpha('--muted'), foreground: withAlpha('--muted-foreground') },
        card: { DEFAULT: withAlpha('--card'), foreground: withAlpha('--card-foreground') },
        success: { DEFAULT: withAlpha('--success'), foreground: withAlpha('--success-foreground'), soft: withAlpha('--success-soft') },
        warning: { DEFAULT: withAlpha('--warning'), foreground: withAlpha('--warning-foreground'), soft: withAlpha('--warning-soft') },
        danger: { DEFAULT: withAlpha('--danger'), foreground: withAlpha('--danger-foreground'), soft: withAlpha('--danger-soft') },
        neutral: { DEFAULT: withAlpha('--neutral'), foreground: withAlpha('--neutral-foreground'), soft: withAlpha('--neutral-soft') },
        chart: { 1: withAlpha('--chart-1'), 2: withAlpha('--chart-2'), 3: withAlpha('--chart-3') },
        // Command-center RAIL group (PRACTITIONER + ADMIN sidebar only — see Sidebar.jsx role guard).
        // ADDITIVE; the light CLIENT rail + the content canvas keep their existing tokens.
        rail: {
          DEFAULT: withAlpha('--rail-bg'),
          top: withAlpha('--rail-bg-top'),
          fg: withAlpha('--rail-fg'),
          'fg-dim': withAlpha('--rail-fg-dim'),
          'active-bg': withAlpha('--rail-active-bg'),
          'active-fg': withAlpha('--rail-active-fg'),
          'hover-bg': withAlpha('--rail-hover-bg'),
          border: withAlpha('--rail-border'),
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'Times New Roman', 'serif'],
        display: ['Montserrat', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        label: ['Montserrat', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 hsl(220 28% 12% / 0.05), 0 6px 16px -6px hsl(220 28% 12% / 0.12)',
        'card-hover': '0 2px 4px -1px hsl(220 28% 12% / 0.10), 0 12px 26px -8px hsl(220 28% 12% / 0.18)',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};
