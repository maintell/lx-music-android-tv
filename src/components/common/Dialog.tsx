import { useImperativeHandle, forwardRef, useMemo, useRef, useState, createContext, useContext } from 'react'
import { View } from 'react-native'

import Modal, { type ModalType } from './Modal'
import Focusable from '@/tv/Focusable'
import { Icon } from '@/components/common/Icon'
import { useKeyboard } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from './Text'
import { scaleSizeH } from '@/utils/pixelRatio'

const HEADER_HEIGHT = 20
/** Android TV：弹窗显示中状态（用于弹窗内主按钮自动聚焦，使 D-pad 进入弹窗） */
export const DialogShownContext = createContext(false)
const styles = createStyle({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalView: {
    maxWidth: '90%',
    minWidth: '60%',
    maxHeight: '78%',
    // backgroundColor: 'white',
    borderRadius: 4,
    // shadowColor: '#000',
    // shadowOffset: {
    //   width: 0,
    //   height: 2,
    // },
    // shadowOpacity: 0.25,
    // shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    height: HEADER_HEIGHT,
  },
  title: {
    paddingLeft: 5,
    paddingRight: 25,
    lineHeight: HEADER_HEIGHT,
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
    borderTopRightRadius: 4,
    flexGrow: 0,
    flexShrink: 0,
    height: HEADER_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
})

export interface DialogProps {
  onHide?: () => void
  keyHide?: boolean
  bgHide?: boolean
  closeBtn?: boolean
  title?: string
  children: React.ReactNode | React.ReactNode[]
  height?: number | `${number}%`
}

export interface DialogType {
  setVisible: (visible: boolean) => void
}

export default forwardRef<DialogType, DialogProps>(({
  onHide,
  keyHide = true,
  bgHide = true,
  closeBtn = true,
  title = '',
  children,
  height,
}: DialogProps, ref) => {
  const theme = useTheme()
  const { keyboardShown, keyboardHeight } = useKeyboard()
  const modalRef = useRef<ModalType>(null)
  // Android TV：弹窗真正显示后置位，驱动主按钮自动聚焦（hasTVPreferredFocus），
  // 使 D-pad 焦点进入弹窗（与下拉菜单同一机制）。
  const [shown, setShown] = useState(false)

  useImperativeHandle(ref, () => ({
    setVisible(visible: boolean) {
      modalRef.current?.setVisible(visible)
    },
  }))

  const handleHide = () => {
    setShown(false)
    onHide?.()
  }

  const closeBtnComponent = useMemo(() => {
    return closeBtn
      ? <Focusable style={{ ...styles.closeBtn, width: scaleSizeH(HEADER_HEIGHT) }} onPress={() => modalRef.current?.setVisible(false)}>
          <Icon name="close" color={theme['c-primary-dark-500-alpha-500']} size={10} />
        </Focusable>
      : null
  }, [closeBtn, theme])

  return (
    <Modal onHide={handleHide} onShow={() => setShown(true)} keyHide={keyHide} bgHide={bgHide} bgColor="rgba(50,50,50,.3)" ref={modalRef}>
      <DialogShownContext.Provider value={shown}>
        <View style={{ ...styles.centeredView, paddingBottom: keyboardShown ? keyboardHeight : 0 }}>
          <View style={{ ...styles.modalView, height, backgroundColor: theme['c-content-background'] }} onStartShouldSetResponder={() => true}>
            <View style={{ ...styles.header, backgroundColor: theme['c-primary-light-100-alpha-100'] }}>
              <Text style={styles.title} size={13} color={theme['c-primary-light-1000']} numberOfLines={1}>{title}</Text>
              {closeBtnComponent}
            </View>
            {children}
          </View>
        </View>
      </DialogShownContext.Provider>
    </Modal>
  )
})
