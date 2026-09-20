import { useState } from 'react'
import { View } from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { importDefaultUserApiSources } from '@/core/userApi'


export interface ScriptImportDefaultType {
  show: () => void
}

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const [importing, setImporting] = useState(false)

  const handleImport = async() => {
    if (importing) return
    setImporting(true)
    try {
      const firstId = await importDefaultUserApiSources()
      toast(firstId ? t('user_api_import_default_success_tip') : t('user_api_import_default_empty_tip'))
    } catch (err: any) {
      toast(t('user_api_import_failed_tip', { message: err.message }), 'long')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Button
      style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
      onPress={handleImport}
    >
      <Text size={14} color={theme['c-button-font']}>
        {importing ? t('user_api_import_default_loading') : t('user_api_btn_import_default')}
      </Text>
    </Button>
  )
}


const styles = createStyle({
  btn: {
    flex: 1,
    padding: 10,
    alignItems: 'center',
    borderRadius: 4,
    marginRight: 15,
  },
})
