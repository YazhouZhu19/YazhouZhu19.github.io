import { dirname, relative, resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { IndexHtmlTransformContext, Plugin, ResolvedConfig } from "vite";

type BuildBundle = NonNullable<IndexHtmlTransformContext["bundle"]>;
export type AnalysisPreloadResources = { modules: string[]; styles: string[] };

const entryModules = [
  "components/analysis-history-panel.tsx",
  "components/integrated-analysis.tsx",
  "lib/analysis-store.ts",
];
const normalize = (path: string) => path.replaceAll("\\", "/");

/** Follow only static imports; unrelated lazy panels keep their existing demand loading. */
export function collectAnalysisPreloads(bundle: BuildBundle, root: string): AnalysisPreloadResources {
  const moduleRoot = realpathSync(root);
  const chunks = Object.values(bundle).filter((file) => file.type === "chunk");
  const modules = new Set<string>();
  const styles = new Set<string>();
  function visit(fileName: string) {
    if (modules.has(fileName)) return;
    const chunk = bundle[fileName];
    // External imports are not local output resources and must not be prefetched.
    if (!chunk || chunk.type !== "chunk") return;
    modules.add(fileName);
    for (const dependency of chunk.imports) visit(dependency);
    for (const css of chunk.viteMetadata?.importedCss ?? []) styles.add(css);
  }
  for (const entry of entryModules) {
    const id = normalize(resolve(moduleRoot, entry));
    const chunk = chunks.find(
      (candidate) =>
        normalize(candidate.facadeModuleId ?? "") === id ||
        Object.keys(candidate.modules).some((moduleId) => normalize(moduleId) === id),
    );
    if (!chunk) throw new Error(`Analysis preload entry is missing from the build: ${entry}`);
    visit(chunk.fileName);
  }
  return { modules: [...modules], styles: [...styles] };
}

const inlineJson = (value: unknown) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

/** The original response promise is handed to analysis-store without consuming its body. */
export function analysisPreloadScript(resources: AnalysisPreloadResources, base: string): string {
  const data = inlineJson({ ...resources, base });
  // Vite finds module links by their href attribute, so preserve its base-relative
  // spelling. Queue history/CSS first, but keep the result's normal priority:
  // real-network comparisons found that deprioritizing it delayed readiness.
  // CSS is only hinted: Vite still installs, orders and awaits styles.
  return `(()=>{if(!/^#\\/(?:analysis|outlook)(?:\\?|$)/.test(location.hash))return;const r=${data};const links=()=>Array.from(document.getElementsByTagName("link"));for(const [files,rel] of [[r.styles,"preload"],[r.modules,"modulepreload"]])for(const file of files){const path=r.base+file;const href=new URL(path,location.href).href;if(links().some(link=>link.href===href&&link.rel===rel))continue;const link=document.createElement("link");link.rel=rel;link.crossOrigin="";if(rel==="preload")link.fetchPriority="high";link.as=rel==="modulepreload"?"script":"style";link.href=path;link.addEventListener("error",()=>link.remove(),{once:true});document.head.appendChild(link);}const url=new URL(r.base+"analysis-bootstrap-v2.json",location.href).href;if(!window.__oevrynAnalysisBootstrap){const controller=new AbortController();const promise=fetch(url,{cache:"no-cache",credentials:"omit",signal:controller.signal});promise.catch(()=>{});window.__oevrynAnalysisBootstrap={url,promise,controller};}})();`;
}

/** Start analysis resources at HTML parse time, before the React entry executes. */
export function analysisPreload(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "research-monitor-analysis-preload",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        if (!context.bundle) return;
        const resources = collectAnalysisPreloads(context.bundle, config.root);
        const base =
          config.base === "./" || config.base === ""
            ? `${normalize(relative(dirname(context.filename), config.root)) || "."}/`
            : config.base;
        return [
          {
            tag: "script",
            attrs: { "data-analysis-preload": true },
            children: analysisPreloadScript(resources, base),
            injectTo: "head",
          },
        ];
      },
    },
  };
}
