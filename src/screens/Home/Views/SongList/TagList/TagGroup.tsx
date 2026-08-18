import { View } from 'react-native'

import Button from '@/components/common/Button'
import { type TagInfoItem } from '@/store/songlist/state'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'

export interface TagGroupProps {
  name: string
  list: TagInfoItem[]
  onTagChange: (name: string, id: string) => void
  activeId: string
  /** Android TV：该组为第一组且抽屉打开中时，第一个可选项自动聚焦 */
  drawerOpened?: boolean
}

export default ({ name, list, onTagChange, activeId, drawerOpened = false }: TagGroupProps) => {
  const theme = useTheme()
  // Android TV：首项自动聚焦（hasTVPreferredFocus 在抽屉真正打开后置 true 才生效）
  let firstSelectableShown = false
  return (
    <View>
      {
        name
          ? <Text style={styles.tagTypeTitle} color={theme['c-font-label']}>{name}</Text>
          : null
      }
      <View style={styles.tagTypeList}>
        {list.map(item => {
          const isActive = activeId == item.id
          let preferredFocus = false
          if (!isActive && !firstSelectableShown) {
            firstSelectableShown = true
            preferredFocus = drawerOpened
          }
          return (
            isActive
              ? (
                  <View style={{ ...styles.tagButton, backgroundColor: theme['c-button-background'] }} key={item.id}>
                    <Text style={styles.tagButtonText} color={theme['c-primary-font-active']}>{item.name}</Text>
                  </View>
                )
              : (
                  <Button
                    style={{ ...styles.tagButton, backgroundColor: theme['c-button-background'] }}
                    key={item.id}
                    hasTVPreferredFocus={preferredFocus}
                    onPress={() => { onTagChange(item.name, item.id) }}
                  >
                    <Text style={styles.tagButtonText} color={theme['c-font']} >{item.name}</Text>
                  </Button>
                )
          )
        })}
      </View>
    </View>
  )
}

const styles = createStyle({
  tagTypeTitle: {
    marginTop: 15,
    marginBottom: 10,
  },
  tagTypeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tagButton: {
    // marginRight: 10,
    borderRadius: 4,
    marginRight: 10,
    marginBottom: 10,
  },
  tagButtonText: {
    fontSize: 13,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
})
