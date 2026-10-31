// DOM tests exercise components, not CSS processing (Vite covers that in build).
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
  return nextLoad(url, context);
}
