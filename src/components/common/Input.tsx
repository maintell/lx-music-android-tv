import { useRef, useImperativeHandle, forwardRef, useCallback, useState } from 'react'
import { TextInput, View, StyleSheet, type TextInputProps } from 'react-native'
import { Icon } from '@/components/common/Icon'
import Focusable, { focusBorderStyle } from '@/tv/Focusable'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { setSpText } from '@/utils/pixelRatio'

const styles = createStyle({
  content: {
    flexDirection: 'row',
    // backgroundColor: 'rgba(0,0,0,0.1)',
    flexGrow: 1,
    flexShrink: 1,
    // height: 38,
    alignItems: 'center',
    // paddingRight: 5,
  },
  input: {
    // backgroundColor: 'rgba(0,0,0,0.1)',
    // backgroundColor: 'white',
    borderRadius: 2,
    paddingTop: 0,
    paddingBottom: 0,
    height: 32,
    paddingLeft: 5,
    paddingRight: 0,
    flexGrow: 1,
    flexShrink: 1,
    // height: '100%',
    // width: '100%',
    fontSize: 14,
  },
  clearBtnContent: {
    flexGrow: 0,
    flexShrink: 0,
  },
  clearBtn: {
    height: '70%',
    paddingLeft: 5,
    paddingRight: 5,
    justifyContent: 'center',
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
})

export interface InputProps extends TextInputProps {
  onChangeText?: (value: string) => void
  onClearText?: () => void
  clearBtn?: boolean
  size?: number
}


export interface InputType {
  blur: () => void
  focus: () => void
  clear: () => void
  isFocused: () => boolean
}

export default forwardRef<InputType, InputProps>(({ onChangeText, onClearText, clearBtn, style, size = 14, ...props }, ref) => {
  const inputRef = useRef<TextInput>(null)
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  // const scaleClearBtn = useRef(new Animated.Value(0)).current

  useImperativeHandle(ref, () => ({
    blur() {
      inputRef.current?.blur()
    },
    focus() {
      inputRef.current?.focus()
    },
    clear() {
      inputRef.current?.clear()
    },
    isFocused() {
      return inputRef.current?.isFocused() ?? false
    },
  }))

  // const showClearBtn = useCallback(() => {
  //   Animated.timing(scaleClearBtn, {
  //     toValue: 1,
  //     duration: 200,
  //     useNativeDriver: true,
  //   }).start()
  // }, [scaleClearBtn])
  // const hideClearBtn = useCallback(() => {
  //   Animated.timing(scaleClearBtn, {
  //     toValue: 0,
  //     duration: 200,
  //     useNativeDriver: true,
  //   }).start()
  // }, [scaleClearBtn])

  const clearText = useCallback(() => {
    inputRef.current?.clear()
    // hideClearBtn()
    onChangeText?.('')
    onClearText?.()
  }, [onChangeText, onClearText])

  const changeText = useCallback((text: string) => {
    // if (text.length) {
    //   showClearBtn()
    // } else {
    //   hideClearBtn()
    // }
    onChangeText?.(text)
  }, [onChangeText])

  return (
    <View style={styles.content}>
      {/* Android TV：输入框必须包成 Focusable，才能成为 D-pad 焦点候选（与源选择/清除按钮同级），
          否则几何焦点查找会跳过裸 EditText。获得焦点或按 OK 时把焦点转入内部 TextInput 以唤起键盘。 */}
      <Focusable
        style={StyleSheet.compose({ flexGrow: 1, flexShrink: 1 }, focusBorderStyle(theme, focused))}
        showBorder={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Android TV：外层 Focusable 作为 D-pad 焦点候选（可见焦点框），
        // 按 OK/中心键时把焦点转入内部 TextInput 以唤起输入键盘。
        onPress={() => {
          inputRef.current?.focus()
        }}
      >
        <TextInput
          autoCapitalize="none"
          onChangeText={changeText}
          autoComplete="off"
          style={StyleSheet.compose({ ...styles.input, color: theme['c-font'], fontSize: setSpText(size) }, style)}
          placeholderTextColor={theme['c-primary-dark-100-alpha-600']}
          selectionColor={theme['c-primary-light-100-alpha-300']}
          ref={inputRef} {...props} />
      </Focusable>
      {/* <View style={styles.clearBtnContent}>
      <Animated.View style={{ ...styles.clearBtnContent, transform: [{ scale: scaleClearBtn }] }}> */}
        {clearBtn
          ? <View style={styles.clearBtnContent}>
              <Focusable style={styles.clearBtn} onPress={clearText}>
                <Icon name="remove" color={theme['c-primary-dark-100-alpha-500']} size={11} />
              </Focusable>
            </View>
          : null
        }
      {/* </Animated.View>
      </View> */}
    </View>
  )
})

