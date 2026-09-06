declare module "*.frag" {
  const source: string;
  export default source;
}

declare module "*.vert" {
  const source: string;
  export default source;
}

declare module "*?royal-codec-url" {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
