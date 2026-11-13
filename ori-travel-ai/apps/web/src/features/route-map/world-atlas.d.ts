/**
 * `world-atlas` (ISC; Natural Earth 1:110m, public domain) ships plain TopoJSON files. Vite bundles the JSON at build
 * time (no network at runtime); this declaration types the one file we import without enabling resolveJsonModule.
 */
declare module 'world-atlas/countries-110m.json' {
  import type { GeometryCollection, Topology } from 'topojson-specification';

  const topology: Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
  export default topology;
}
