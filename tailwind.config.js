/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {},
  },
  // The summary tab builds class names like `bg-${color}-500/10` at runtime.
  // Tailwind can't see those by scanning the source text, so we safelist the
  // exact combinations used (see the [k,v,c] map in the employee Summary tab).
  safelist: [
    {
      // blue and green were missing here — that's plan.md §4.5 #2 ("two stat cards
      // render unstyled"). Keep this list and the STAT_CARD_COLORS map in
      // components/ui/StatCard.jsx in sync; a color used by one but not the other
      // reproduces the same bug.
      pattern:
        /^(bg|text|border)-(red|emerald|amber|yellow|indigo|purple|cyan|orange|violet|blue|green|slate|sky)-(300|400|500|600)(\/(10|20|30|40|60))?$/,
    },
  ],
  plugins: [],
}
