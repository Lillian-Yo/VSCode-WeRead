"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.warnDeprecatedNoAccountParam = void 0;
const warnedKeys = new Set();
function warnDeprecatedNoAccountParam(scope, activeAccountId) {
    const key = `${scope}:${activeAccountId || ''}`;
    if (warnedKeys.has(key)) {
        return;
    }
    warnedKeys.add(key);
    const suffix = activeAccountId ? ` (activeAccountId=${activeAccountId})` : '';
    console.warn(`[weread][deprecated] ${scope} 未显式传入 accountId，已转发到当前活跃账号${suffix}`);
}
exports.warnDeprecatedNoAccountParam = warnDeprecatedNoAccountParam;
//# sourceMappingURL=deprecation.js.map