import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const rendererRoot = new URL('../src/renderer/src/', import.meta.url)

function read(relativePath) {
  return readFileSync(new URL(relativePath, rendererRoot), 'utf8')
}

test('No-model composer copy explains that a model must be configured', () => {
  const zh = JSON.parse(read('i18n/locales/zh-CN/chat.json'))
  const en = JSON.parse(read('i18n/locales/en-US/chat.json'))

  assert.match(zh.input.disabled_community_no_chat_model, /暂无可用模型.*配置模型/)
  assert.match(zh.input.disabled_no_chat_model, /暂无可用模型.*配置模型/)
  assert.match(en.input.disabled_community_no_chat_model, /No models available.*Configure a model/)
  assert.match(en.input.disabled_no_chat_model, /No models available.*Configure a model/)
  assert.match(zh.errors.communityModelNotConfigured, /AI NOT CONFIGURED/)
  assert.match(en.errors.communityModelNotConfigured, /AI NOT CONFIGURED/)
  assert.doesNotMatch(zh.errors.communityModelNotConfigured, /AdminDash/)
  assert.doesNotMatch(en.errors.communityModelNotConfigured, /AdminDash/)

  assert.match(zh.errors.modelNotConfigured, /AdminDash/)
  assert.match(en.errors.modelNotConfigured, /AdminDash/)
})

test('Community copy selection remains edition-aware at every no-model surface', () => {
  const distribution = read('config/distribution.ts')
  assert.match(distribution, /VITE_DISTRIBUTION_KIND/)
  assert.match(distribution, /community_no_chat_model/)

  for (const file of [
    'stores/chat/messages/runtime/applyBlockedSubmissionFeedback.ts',
    'components/chat/hooks/useChatCallbacks.ts',
    'components/chat/panel/ChatContent.tsx',
    'components/chat/hooks/useSessionScopedComposerModel.ts',
  ]) {
    assert.match(read(file), /isCommunityDistribution/, `${file} must use the Community boundary`)
  }

  assert.match(
    read('components/chat/hooks/useChatPanelLifecycle.ts'),
    /noChatModelDisabledReason/,
    'useChatPanelLifecycle must use the distribution-resolved no-model reason',
  )
})
