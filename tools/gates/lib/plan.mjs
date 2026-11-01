// Cabal の plan.json を読む。条件節やフラグが解決された後の、実際の依存関係である。
// ユニットはコンポーネント単位(component-name と depends)か、パッケージ単位(components)のどちらかで現れる。
// build-type: Custom のパッケージは後者になるので、両方を扱わないと検査が素通りする。

const PRODUCT = /^(lib|exe|flib)(:|$)/;

/** 製品のコンポーネントが リンクする依存を返す。製品のコンポーネントを持たないユニットは null。 */
function productDeps(unit) {
  if (unit.components) {
    const products = Object.entries(unit.components).filter(([name]) => PRODUCT.test(name));
    return products.length > 0 ? products.flatMap(([, c]) => c.depends ?? []) : null;
  }
  return PRODUCT.test(unit['component-name'] ?? '') ? unit.depends ?? [] : null;
}

/** ビルドに必要なすべての依存(リンクするものとビルドツール)を返す。 */
function buildDeps(unit) {
  const of = (u) => [...(u.depends ?? []), ...(u['exe-depends'] ?? [])];
  return unit.components ? Object.values(unit.components).flatMap(of) : of(unit);
}

function reachable(installPlan, roots, edges) {
  const byId = new Map(installPlan.map((u) => [u.id, u]));
  const stack = [...roots];
  const visited = new Set();
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const unit = byId.get(id);
    if (unit) stack.push(...edges(unit));
  }
  return [...visited].map((id) => byId.get(id)).filter(Boolean);
}

/**
 * ローカルパッケージの library と executable から到達できるパッケージ名を返す。
 * テストスイートとベンチマークは製品に含まれないので起点にしない。
 */
export function productClosure(installPlan) {
  const locals = installPlan.filter((u) => u.style === 'local');
  const roots = locals.flatMap((u) => productDeps(u) ?? []);
  const units = reachable(installPlan, roots, (u) => productDeps(u) ?? u.depends ?? []);
  return new Set(units.filter((u) => u.style !== 'local').map((u) => u['pkg-name']));
}

/** 製品のコンポーネントの実際の依存が、層の定義に沿っているか。 */
export function layerViolations(installPlan, backendPolicy) {
  const byId = new Map(installPlan.map((u) => [u.id, u]));
  const prefix = backendPolicy.prefix;
  const out = [];
  for (const unit of installPlan) {
    if (unit.style !== 'local') continue;
    const deps = productDeps(unit);
    if (deps === null) continue;
    const pkg = unit['pkg-name'];
    const layer = pkg.startsWith(prefix) ? pkg.slice(prefix.length) : pkg;
    const rule = backendPolicy.layers[layer];
    if (!rule) {
      out.push(`${pkg} は未定義の層`);
      continue;
    }
    for (const id of deps) {
      const dep = byId.get(id)?.['pkg-name'];
      if (!dep) {
        out.push(`${pkg} の依存 ${id} を plan.json から解決できない`);
      } else if (dep === pkg) {
        continue;
      } else if (dep.startsWith(prefix)) {
        if (!rule.internal.includes(dep.slice(prefix.length))) {
          out.push(`${layer} は ${dep.slice(prefix.length)} に依存できない`);
        }
      } else if (rule.externalAllow && !rule.externalAllow.includes(dep)) {
        out.push(`${layer} は外部パッケージ ${dep} に依存できない`);
      }
    }
  }
  return out;
}

/**
 * 外部の library のライセンスを集める。実行ファイルだけのユニットは情報を持たないので対象外にする。
 * WHY NOT: plan.json の全ユニットを見ない。依存の内部ベンチマークなど、ローカルから到達しないユニットは
 * ビルドされず情報も無いが、リンクもされないのでライセンスの問題にならない。
 * @param readLicense unit id → ライセンス文字列。見つからなければ null
 * @returns {{found: Array<{name:string, license:string}>, missing: string[]}}
 */
export function collectLicenses(installPlan, readLicense) {
  const locals = installPlan.filter((u) => u.style === 'local');
  const units = reachable(installPlan, locals.map((u) => u.id), buildDeps);
  const found = [];
  const missing = [];
  const seen = new Set();
  for (const unit of units) {
    const name = unit['pkg-name'];
    if (!name || unit.type === 'pre-existing' || unit.style !== 'global' || seen.has(name)) continue;
    const hasLibrary = unit.components
      ? 'lib' in unit.components
      : /^(lib|flib)(:|$)/.test(unit['component-name'] ?? 'lib');
    if (!hasLibrary) continue;
    seen.add(name);
    const license = readLicense(unit.id);
    if (license) found.push({ name, license });
    else missing.push(name);
  }
  return { found, missing };
}
