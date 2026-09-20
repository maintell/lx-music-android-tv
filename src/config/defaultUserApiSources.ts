/**
 * 内置默认在线源（自定义音源）列表。
 *
 * 这些源由社区维护（pdone/lx-music-source），通过本列表在应用首次启动时
 * 自动拉取导入，并可通过「自定义源」弹窗中的「导入默认源」按钮重新导入。
 *
 * ⚠️ 注意：源脚本内容来自第三方，导入前请自行评估其可用性；
 * 这与项目「默认不内置音源」的原设计不同，属于本分支的定制行为。
 */

export interface DefaultUserApiSource {
  /** 用于去重与展示的简称（取自源脚本 @name，这里仅作标识） */
  name: string
  /** 脚本地址 */
  url: string
}

export const defaultUserApiSources: DefaultUserApiSource[] = [
  { name: 'sixyin', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js' },
  { name: 'huibq', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js' },
  { name: 'flower', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/flower/latest.js' },
  { name: 'lx', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/lx/latest.js' },
  { name: 'changqing', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/changqing/latest.js' },
  { name: 'huanyin', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/huanyin/latest.js' },
  { name: 'ikun', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/ikun/latest.js' },
  { name: 'grass', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/grass/latest.js' },
  { name: 'juhe', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/juhe/latest.js' },
  { name: 'qdy', url: 'https://ghproxy.net/raw.githubusercontent.com/pdone/lx-music-source/main/qdy/latest.js' },
]
