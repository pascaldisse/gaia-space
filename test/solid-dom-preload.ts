// bun-test preload: makes real Solid client-DOM rendering work under `bun test`.
//   1. installs a happy-dom global environment (document/window/SVG)
//   2. forces `solid-js/web` to its browser (DOM) build, not the SSR build
//   3. compiles .tsx/.jsx with babel-preset-solid so JSX becomes real DOM ops
// Used by icon.test.tsx to assert against actually-rendered SVG, not config.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
// @ts-expect-error no types for the preset
import solidPreset from "babel-preset-solid";
// @ts-expect-error no types for the plugin
import tsPlugin from "@babel/plugin-transform-typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

GlobalRegistrator.register();

const webClient = resolve(import.meta.dir, "../node_modules/solid-js/web/dist/web.js");
// Solid's *core* also resolves to its SSR build under bun's default conditions,
// which has no reactive graph (createResource/createMemo throw). Views that load
// data need the client build for both halves.
const coreClient = resolve(import.meta.dir, "../node_modules/solid-js/dist/solid.js");

plugin({
  name: "solid-jsx",
  setup(build) {
    // `solid-js/web` resolves to the SSR build under bun's default conditions.
    // Intercept the load of server.js and serve the browser build's source
    // instead, so render()/insert() drive happy-dom's real DOM.
    build.onLoad({ filter: /solid-js[\\/]web[\\/]dist[\\/]server\.js$/ }, () => ({
      contents: readFileSync(webClient, "utf8"),
      loader: "js",
    }));
    build.onLoad({ filter: /solid-js[\\/]dist[\\/]server\.js$/ }, () => ({
      contents: readFileSync(coreClient, "utf8"),
      loader: "js",
    }));
    build.onLoad({ filter: /\.[jt]sx$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const out = transformSync(src, {
        filename: args.path,
        sourceMaps: "inline",
        // Parse as TSX (jsx + typescript), strip types, then let solid turn JSX
        // into real DOM template ops so happy-dom renders actual SVG geometry.
        parserOpts: { plugins: ["jsx", "typescript"] },
        presets: [solidPreset],
        plugins: [[tsPlugin, {}]],
      });
      return { contents: out?.code ?? src, loader: "js" };
    });
  },
});
