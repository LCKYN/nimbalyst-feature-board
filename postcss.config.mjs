// The Tailwind config is named by absolute path so it is found whatever the
// build's working directory is.
import { fileURLToPath } from 'url';

export default {
  plugins: {
    tailwindcss: {
      config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)),
    },
  },
};
