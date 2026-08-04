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
      pattern:
        /^(bg|text|border)-(red|emerald|amber|yellow|indigo|purple|cyan|orange|violet)-(300|400|500|600)(\/(10|20|30|40|60))?$/,
    },
  ],
  plugins: [],
}
