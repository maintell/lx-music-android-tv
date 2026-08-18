/**
 * Android TV / 遥控器焦点基础设施（阶段 2）
 *
 * 架构说明：
 * - RN 0.73 在 Android TV 上不提供任何焦点事件的 JS 回调（onFocus/onBlur/onKeyDown 均不触发）。
 * - 焦点边框样式已在 focusBorderStyle 中声明（3px 主题色 + 发光），但显示需要框架支持焦点事件。
 * - 使用 TouchableOpacity 以确保 onPress / focusable 等原生属性正常工作。
 *
 * 暴露：
 *  - Focusable        包装可交互元素，OK 键触发 onPress，MENU 键触发 onMenu。
 *  - PagerTV          包装 react-native-pager-view。
 *  - focusBorderStyle 焦点态边框样式构造器（供自定义组件复用）。
 */

import { memo, useState, type ReactNode } from 'react'
import { TouchableOpacity, type TouchableOpacityProps, type ViewStyle } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import { IS_TV } from './constants'

/** Android 遥控器 MENU 键 keyCode */
export const KEYCODE_MENU = 82

/** TV 方向键/菜单键事件的轻量类型（RN 0.73 类型未导出原生 keyEvent 细节） */
export type TVKeyEvent = { nativeEvent: { keyCode: number } }

/** 生成「获得焦点时」叠加的主题色边框样式；手机端或失焦时返回空对象。 */
export const focusBorderStyle = (theme: ReturnType<typeof useTheme>, focused: boolean): ViewStyle => {
  if (!focused) return {}
  const color = theme['c-primary']
  return {
    borderWidth: 3,
    borderColor: color,
    borderRadius: 4,
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 6,
  }
}

export interface FocusableProps extends TouchableOpacityProps {
  /** MENU 键回调 */
  onMenu?: () => void
  /** 方向键/按键回调 */
  onKeyDown?: (e: TVKeyEvent) => void
  /** 是否应用默认焦点边框（默认 true；注意：RN 0.73 的焦点事件不触发，边框暂不生效） */
  showBorder?: boolean
  /** Android TV：挂载/置为 true 时请求焦点 */
  hasTVPreferredFocus?: boolean
  children?: ReactNode
  style?: ViewStyle
}

/**
 * TV 焦点容器：使用 TouchableOpacity 确保 OK 键触发 onPress、MENU 键触发 onMenu。
 * RN 0.73 在 Android TV 上不提供 onFocus/onBlur/onKeyDown 回调，因此焦点边框
 * 样式（focusBorderStyle）虽已声明但暂无法通过 JS 事件动态切换。
 * 后续可考虑通过 native 模块或升级 RN 版本（react-native-tvos）解决。
 */
const Focusable = memo(({ onMenu, onKeyDown, showBorder = true, hasTVPreferredFocus, children, style, ...props }: FocusableProps) => {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const borderStyle: ViewStyle = showBorder ? focusBorderStyle(theme, focused) : {}

  const extraProps = {
    focusable: true,
    hasTVPreferredFocus: hasTVPreferredFocus,
  }

  return (
    <TouchableOpacity
      {...props}
      style={[borderStyle, style]}
      {...(extraProps as object)}
    >
      {children}
    </TouchableOpacity>
  )
})

export default Focusable