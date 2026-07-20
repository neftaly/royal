const box = (type: string, payload: Uint8Array): Uint8Array => {
  const bytes = new Uint8Array(8 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.byteLength);
  for (let index = 0; index < 4; index += 1) bytes[4 + index] = type.charCodeAt(index);
  bytes.set(payload, 8);
  return bytes;
};

const joined = (...parts: readonly Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
};

export const createAvifHeader = (
  width: number,
  height: number,
  options: Readonly<{ itemId?: number; wide?: boolean }> = {},
): Uint8Array => {
  const itemId = options.itemId ?? 1;
  const wide = options.wide === true;
  const ftyp = box("ftyp", joined(
    new TextEncoder().encode("avif"),
    new Uint8Array(4),
    new TextEncoder().encode("avifmif1"),
  ));
  const pitmPayload = new Uint8Array(wide ? 8 : 6);
  const pitmView = new DataView(pitmPayload.buffer);
  pitmPayload[0] = wide ? 1 : 0;
  if (wide) pitmView.setUint32(4, itemId);
  else pitmView.setUint16(4, itemId);
  const ispePayload = new Uint8Array(12);
  const ispeView = new DataView(ispePayload.buffer);
  ispeView.setUint32(4, width);
  ispeView.setUint32(8, height);
  const ipco = box("ipco", box("ispe", ispePayload));
  const ipmaPayload = new Uint8Array(wide ? 15 : 12);
  const ipmaView = new DataView(ipmaPayload.buffer);
  ipmaPayload[0] = wide ? 1 : 0;
  if (wide) ipmaPayload[3] = 1;
  ipmaView.setUint32(4, 1);
  let offset = 8;
  if (wide) {
    ipmaView.setUint32(offset, itemId);
    offset += 4;
  } else {
    ipmaView.setUint16(offset, itemId);
    offset += 2;
  }
  ipmaPayload[offset] = 1;
  if (wide) ipmaView.setUint16(offset + 1, 0x8001);
  else ipmaPayload[offset + 1] = 0x81;
  const iprp = box("iprp", joined(ipco, box("ipma", ipmaPayload)));
  return joined(ftyp, box("meta", joined(new Uint8Array(4), box("pitm", pitmPayload), iprp)));
};
