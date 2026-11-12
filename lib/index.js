/**
 * dsh-rightbar-max-keep-rail 宿主半。
 *
 * 这一行插件存在的唯一理由，是让浏览器半被加载：client-modules 是**按 loader row**
 * 发现浏览器半的 —— 它解析该 row 的模块，再读那个包 package.json 的
 * `dsh.client`（`packages/client/modules/src/index.ts` `resolveMeta()`），
 * 所以包里必须有一个能被当作 row 挂上的宿主模块，且 `dsh.client.platform === 'web'`、
 * `exports["./client"]` 指向浏览器半。
 *
 * 宿主侧不需要任何服务：全部工作在浏览器里完成（一条 CSS + 量一次左栏宽度），
 * 所以这里的 apply 什么都不做。
 */

/** cordis 插件名：与 npm 包名、cordis.patch.yml 的 row name 一致。 */
export const name = 'dsh-rightbar-max-keep-rail'

/** 不依赖宿主服务。 */
export const inject = []

/**
 * 空体：浏览器半已由 client-modules 拉起，宿主侧无事可做。
 */
export function apply() {}
