/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  solidTexture,
  textureAsset,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  unlitMaterial,
} from '@royal/renderer-core';
import {
  createSvgGatewayGeometry,
  createSvgRasterTextureSource,
  svgPathToContours,
  type SvgGatewayGeometry,
  type SvgGatewayInput,
} from '@royal/renderer-core/svg';

export type SvgGatewayExampleId = 'star' | 'rounded-card' | 'cutout';

type SvgGatewayCase = {
  readonly geometry: SvgGatewayGeometry;
  readonly id: SvgGatewayExampleId;
  readonly label: string;
  readonly meshTriangles: number;
  readonly rasterCacheKey: string;
  readonly svg: string;
};

type SvgGatewayPanel = {
  readonly caseId: SvgGatewayExampleId;
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

export const svgGatewayCameraBounds = {
  bottom: -1.45,
  left: -4.4,
  right: 4.4,
  top: 1.85,
} as const;

const svgSize = 256;
const panelSize = 1.55;
const panelGeometry = boxGeometry({ size: [panelSize, panelSize, 0.06] });
const panelBackGeometry = boxGeometry({ size: [panelSize + 0.14, panelSize + 0.14, 0.04] });
const labelStripGeometry = boxGeometry({ size: [panelSize + 0.14, 0.34, 0.04] });
const fallbackTexture = solidTexture({
  color: [0.09, 0.1, 0.12, 1],
  id: 'svg-gateway-fallback',
});
const activeChrome = unlitMaterial({
  baseColor: solidTexture({ color: [0.98, 0.78, 0.32, 1], id: 'svg-gateway-active' }),
});
const idleChrome = unlitMaterial({
  baseColor: solidTexture({ color: [0.2, 0.26, 0.3, 1], id: 'svg-gateway-idle' }),
});
const labelChrome = unlitMaterial({
  baseColor: solidTexture({ color: [0.045, 0.052, 0.058, 1], id: 'svg-gateway-label' }),
});

const starPoints = [
  [128, 20],
  [153.9, 92.4],
  [230.7, 94.6],
  [169.8, 141.6],
  [191.5, 215.4],
  [128, 172],
  [64.5, 215.4],
  [86.2, 141.6],
  [25.3, 94.6],
  [102.1, 92.4],
] as const;
const starPointsText = starPoints.map(([x, y]) => `${x},${y}`).join(' ');
const roundedCardPath =
  'M 34 28 H 222 A 24 24 0 0 1 246 52 V 204 A 24 24 0 0 1 222 228 H 34 A 24 24 0 0 1 10 204 V 52 A 24 24 0 0 1 34 28 Z';
const cutoutPath =
  'M 24 24 H 232 V 232 H 24 Z M 128 58 L 198 128 L 128 198 L 58 128 Z';
const cutoutSubpathContours = svgPathToContours(cutoutPath, { id: 'cutout-subpath' });

const svgToDataUri = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const createGatewayCase = ({
  id,
  input,
  label,
  svg,
}: {
  readonly id: SvgGatewayExampleId;
  readonly input: SvgGatewayInput;
  readonly label: string;
  readonly svg: string;
}): SvgGatewayCase => {
  const geometry = createSvgGatewayGeometry(input, { id });
  const raster = createSvgRasterTextureSource({
    height: svgSize,
    id: `${id}-raster`,
    svg,
    width: svgSize,
  });

  return {
    geometry,
    id,
    label,
    meshTriangles: geometry.mesh.indices.length / 3,
    rasterCacheKey: raster.cacheKey,
    svg,
  };
};

export const svgGatewayCases = [
  createGatewayCase({
    id: 'star',
    input: { kind: 'polygon', id: 'star-shape', points: starPoints },
    label: 'Polygon pick',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}">
  <rect width="256" height="256" rx="28" fill="#102128"/>
  <polygon id="star-shape" points="${starPointsText}" fill="#f2b640"/>
  <path d="M128 44 L146 98 L203 100 L158 134 L175 188 L128 156 L81 188 L98 134 L53 100 L110 98 Z" fill="#fff1b4" opacity="0.38"/>
</svg>`,
  }),
  createGatewayCase({
    id: 'rounded-card',
    input: { d: roundedCardPath, id: 'rounded-card-path', kind: 'path' },
    label: 'Arc path pick',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}">
  <path id="rounded-card-path" d="${roundedCardPath}" fill="#52c7b8"/>
  <path d="M48 82 H208" stroke="#102128" stroke-width="16" stroke-linecap="round"/>
  <path d="M48 128 H178" stroke="#102128" stroke-width="16" stroke-linecap="round" opacity="0.7"/>
  <path d="M48 174 H134" stroke="#102128" stroke-width="16" stroke-linecap="round" opacity="0.45"/>
</svg>`,
  }),
  createGatewayCase({
    id: 'cutout',
    input: {
      contours: [
        cutoutSubpathContours[0] ?? { points: [[24, 24], [232, 24], [232, 232], [24, 232]] },
        {
          ...(cutoutSubpathContours[1] ?? { points: [[128, 58], [198, 128], [128, 198], [58, 128]] }),
          role: 'hole',
        },
      ],
      fillRule: 'nonzero',
      kind: 'contours',
    },
    label: 'Subpath hole',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}">
  <rect width="256" height="256" rx="20" fill="#0f1c24"/>
  <path d="${cutoutPath}" fill="#e7636f" fill-rule="evenodd"/>
  <circle cx="128" cy="128" r="15" fill="#f5f1d0"/>
</svg>`,
  }),
] as const satisfies readonly SvgGatewayCase[];

const panels = [
  { caseId: 'star', height: panelSize, width: panelSize, x: -2.32, y: 0.1 },
  { caseId: 'rounded-card', height: panelSize, width: panelSize, x: 0, y: 0.1 },
  { caseId: 'cutout', height: panelSize, width: panelSize, x: 2.32, y: 0.1 },
] as const satisfies readonly SvgGatewayPanel[];

const materialsById = new Map(
  svgGatewayCases.map((shape) => [
    shape.id,
    unlitMaterial({
      baseColor: textureAsset({
        colorSpace: 'srgb',
        fallback: fallbackTexture,
        id: `svg-gateway-${shape.id}-texture`,
        sampler: {
          magFilter: 'linear',
          minFilter: 'linear',
          wrapS: 'clamp-to-edge',
          wrapT: 'clamp-to-edge',
        },
        uri: svgToDataUri(shape.svg),
      }),
    }),
  ]),
);

const metricText = (shape: SvgGatewayCase): string =>
  `${shape.meshTriangles} tris | ${shape.geometry.contours.length} contour${shape.geometry.contours.length === 1 ? '' : 's'}`;

const textNode = (
  text: string,
  origin: readonly [x: number, y: number, z: number],
  color: Rgba,
  fontSize: number,
): RenderNode =>
  (
    <text
      color={color}
      fontSize={fontSize}
      lineHeight={fontSize * 1.2}
      origin={origin}
      text={text}
    />
  ) as RenderNode;

const panelNode = (
  panel: SvgGatewayPanel,
  activeId: SvgGatewayExampleId | undefined,
): readonly RenderNode[] => {
  const shape = svgGatewayCases.find((candidate) => candidate.id === panel.caseId);
  const material = materialsById.get(panel.caseId);
  if (shape === undefined || material === undefined) return [];
  const active = activeId === panel.caseId;

  return [
    (
      <mesh
        geometry={panelBackGeometry}
        material={active ? activeChrome : idleChrome}
        transform={{ position: [panel.x, panel.y, -0.04], rotation: [0, 0, 0] }}
      />
    ) as RenderNode,
    (
      <mesh
        geometry={panelGeometry}
        material={material}
        transform={{ position: [panel.x, panel.y, 0], rotation: [0, 0, 0] }}
      />
    ) as RenderNode,
    (
      <mesh
        geometry={labelStripGeometry}
        material={labelChrome}
        transform={{ position: [panel.x, panel.y - 1.02, 0.03], rotation: [0, 0, 0] }}
      />
    ) as RenderNode,
    textNode(shape.label, [panel.x - 0.68, panel.y - 0.94, 0.1], [0.92, 0.96, 0.95, 1], 0.12),
    textNode(metricText(shape), [panel.x - 0.68, panel.y - 1.12, 0.1], [0.68, 0.75, 0.76, 1], 0.088),
  ];
};

const caseById = (id: SvgGatewayExampleId): SvgGatewayCase | undefined =>
  svgGatewayCases.find((candidate) => candidate.id === id);

export const svgGatewayHitTargetAt = (
  worldPoint: readonly [x: number, y: number],
): SvgGatewayExampleId | undefined => {
  for (const panel of panels) {
    const left = panel.x - panel.width / 2;
    const right = panel.x + panel.width / 2;
    const bottom = panel.y - panel.height / 2;
    const top = panel.y + panel.height / 2;
    const [worldX, worldY] = worldPoint;
    if (worldX < left || worldX > right || worldY < bottom || worldY > top) continue;
    const shape = caseById(panel.caseId);
    if (shape === undefined) continue;

    const localX = ((worldX - left) / panel.width) * svgSize;
    const localY = ((top - worldY) / panel.height) * svgSize;
    if (shape.geometry.hitRegion.contains([localX, localY])) return panel.caseId;
  }

  return undefined;
};

export const svgGatewayScene = (activeId?: SvgGatewayExampleId): RenderRoot => (
  <scene>
    <pass clearColor={[0.04, 0.048, 0.052, 1]}>
      <orthographicCamera
        bottom={svgGatewayCameraBounds.bottom}
        far={100}
        left={svgGatewayCameraBounds.left}
        near={0.1}
        position={[0, 0, 10]}
        right={svgGatewayCameraBounds.right}
        rotation={[0, 0, 0]}
        top={svgGatewayCameraBounds.top}
      />
      {textNode('SVG gateway', [-3.95, 1.42, 0.1], [0.93, 0.97, 0.96, 1], 0.26)}
      {textNode(
        activeId === undefined ? 'Pointer uses flattened SVG pick regions' : `Picked ${caseById(activeId)?.label ?? activeId}`,
        [-3.95, 1.08, 0.1],
        activeId === undefined ? [0.64, 0.72, 0.75, 1] : [0.98, 0.78, 0.32, 1],
        0.13,
      )}
      {panels.flatMap((panel) => panelNode(panel, activeId))}
    </pass>
  </scene>
) as RenderRoot;
