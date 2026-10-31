import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  { ignores: [".next/**", "node_modules/**", "public/sw.js", "public/audio-worklet.js"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
