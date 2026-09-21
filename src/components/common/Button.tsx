import { useTheme } from '@/store/theme/hook'
import { useMemo, useRef, useImperativeHandle, forwardRef, useState } from 'react'
import { Pressable, type PressableProps, StyleSheet, type View, type ViewProps } from 'react-native'
import { IS_TV } from '@/tv/constants'
import { focusBorderStyle } from '@/tv/Focusable'
// import { AppColors } from '@/theme'


export interface BtnProps extends PressableProps {
  ripple?: PressableProps['android_ripple']
  style?: ViewProps['style']
  onChangeText?: (value: string) => void
  onClearText?: () => void
  /** Android TV：挂载/置为 true 时请求焦点（用于抽屉/弹窗内首项自动聚焦） */
  hasTVPreferredFocus?: boolean
  children: React.ReactNode
}


export interface BtnType {
  measure: (callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void) => void
}

export default forwardRef<BtnType, BtnProps>(({ ripple: propsRipple = {}, disabled, children, style, hasTVPreferredFocus, ...props }, ref) => {
  const theme = useTheme()
  const btnRef = useRef<View>(null)
  const [focused, setFocused] = useState(false)
  const ripple = useMemo(() => ({
    color: theme['c-primary-dark-200-alpha-200'],
    ...propsRipple,
  }), [theme, propsRipple])

  useImperativeHandle(ref, () => ({
    measure(callback) {
      btnRef.current?.measure(callback)
    },
  }))

  // Android TV：获得焦点时叠加主题色边框 + 阴影，提供醒目可见的焦点反馈
  // 3px 宽度 + 发光阴影确保在各种主题下都清晰可辨（反色效果）
  // Android TV：获得焦点时叠加更醒目的主题色边框（复用 focusBorderStyle，单一来源）
  const focusStyle = focusBorderStyle(theme, focused)

  return (
    <Pressable
      android_ripple={ripple}
      disabled={disabled}
      style={StyleSheet.compose({ opacity: disabled ? 0.3 : 1 }, StyleSheet.compose(style, focusStyle))}
      {...props}
      ref={btnRef}
      onFocus={(e) => {
        setFocused(true)
        props.onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        props.onBlur?.(e)
      }}
      {...(IS_TV ? { focusable: true, hasTVPreferredFocus } : {})}
    >
      {children}
    </Pressable>
  )
})

