declare module "*.wasm?url" {
  const url: string;
  export default url;
}

declare module "*.frag" {
  const source: string;
  export default source;
}

declare module "*.vert" {
  const source: string;
  export default source;
}
