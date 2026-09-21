import { action, state } from '@/store/userApi'
import { addUserApi, getUserApiScript, removeUserApi as removeUserApiFromStore, setUserApiAllowShowUpdateAlert as setUserApiAllowShowUpdateAlertFromStore } from '@/utils/data'
import { destroy, loadScript } from '@/utils/nativeModules/userApi'
import { log as writeLog } from '@/utils/log'
import { httpFetch } from '@/utils/request'
import { defaultUserApiSources } from '@/config/defaultUserApiSources'


export const setUserApi = async(apiId: string) => {
  global.lx.qualityList = {}
  setUserApiStatus(false, 'initing')

  const target = state.list.find(api => api.id === apiId)
  if (!target) throw new Error('api not found')
  const script = await getUserApiScript(target.id)
  loadScript({ ...target, script })
}

export const destroyUserApi = () => {
  destroy()
}


export const setUserApiStatus: typeof action['setStatus'] = (status, message) => {
  action.setStatus(status, message)
}

export const setUserApiList: typeof action['setUserApiList'] = (list) => {
  action.setUserApiList(list)
}

export const importUserApi = async(script: string) => {
  const info = await addUserApi(script)
  action.addUserApi(info)
}

/**
 * 从脚本首部注释块解析 @name 作为去重标识。
 */
const getScriptName = (script: string): string => {
  const block = /^\/\*[\S|\s]+?\*\//.exec(script)?.[0]
  if (!block) return ''
  const matched = /^\s?\*\s?@name\s(.+)$/m.exec(block)
  return matched ? matched[1].trim() : ''
}

/**
 * 批量导入内置默认在线源（community 维护的脚本）。
 *
 * - 以 @name 作为去重键，已存在的同名源会被跳过（支持「导入默认源」按钮重复触发）。
 * - 单个源拉取/解析失败不影响其余源。
 * - 返回首个成功导入（或已存在）的源 id，供调用方激活使用；没有任何源时返回 null。
 */
export const importDefaultUserApiSources = async(): Promise<string | null> => {
  const importedNames = new Set(state.list.map(api => api.name))
  let firstId: string | null = state.list[0]?.id ?? null

  for (const { url } of defaultUserApiSources) {
    let script: string
    try {
      script = await httpFetch(url).promise.then(resp => resp.body) as string
    } catch (err: any) {
      writeLog.warn(`import default user api failed: ${url}\n${err.message}`)
      continue
    }
    if (!script || script.length > 9_000_000) continue

    const name = getScriptName(script)
    if (name && importedNames.has(name)) continue

    let info: LX.UserApi.UserApiInfo
    try {
      info = await addUserApi(script)
    } catch (err: any) {
      writeLog.warn(`add default user api failed: ${url}\n${err.message}`)
      continue
    }
    // 同步更新响应式 store，使弹窗/设置列表立即刷新（无需重启 App）。
    // 若漏掉这一步，state.list 保持不变，下一次点击会重建去重集合并重复导入同名源。
    action.addUserApi(info)
    importedNames.add(info.name)
    if (!firstId) firstId = info.id
  }

  return firstId
}

export const removeUserApi = async(ids: string[]) => {
  const list = await removeUserApiFromStore(ids)
  action.setUserApiList(list)
}

export const setUserApiAllowShowUpdateAlert = async(id: string, enable: boolean) => {
  await setUserApiAllowShowUpdateAlertFromStore(id, enable)
  action.setUserApiAllowShowUpdateAlert(id, enable)
}

export const log = {
  r_info(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.info(...params)
  },
  r_warn(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.warn(...params)
  },
  r_error(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.error(...params)
  },
  log(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.info(...params)
  },
  info(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.info(...params)
  },
  warn(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.warn(...params)
  },
  error(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.error(...params)
  },
}
