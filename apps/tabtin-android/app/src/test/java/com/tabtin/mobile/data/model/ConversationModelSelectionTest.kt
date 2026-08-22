package com.tabtin.mobile.data.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ConversationModelSelectionTest {

    private val modelA = LlmModel(
        id = "00000000-0000-0000-0000-000000000001",
        modelName = "Model A",
    )
    private val modelB = LlmModel(
        id = "00000000-0000-0000-0000-000000000002",
        modelName = "Model B",
    )

    @Test
    fun `existing session current model wins over every fallback`() {
        val selected = resolveConversationChatModel(
            session = ChatSession(
                id = "session",
                currentModelId = modelB.id,
                defaultModelId = modelA.id,
            ),
            availableModels = listOf(modelA, modelB),
            catalogDefaultModelId = modelA.id,
        )

        assertEquals(modelB.id, selected?.id)
    }

    @Test
    fun `missing session model falls back through session then catalog defaults`() {
        val selected = resolveConversationChatModel(
            session = ChatSession(id = "session", defaultModelId = modelB.id),
            availableModels = listOf(modelA, modelB),
            catalogDefaultModelId = modelA.id,
        )

        assertEquals(modelB.id, selected?.id)
    }

    @Test
    fun `new conversation keeps last selected model before catalog default`() {
        val selected = resolveNewConversationChatModel(
            draftModelId = null,
            stickyModelId = modelB.id,
            preferredModelId = modelA.id,
            catalogDefaultModelId = modelA.id,
            availableModels = listOf(modelA, modelB),
        )

        assertEquals(modelB.id, selected?.id)
    }

    @Test
    fun `new conversation uses agent preferred when sticky is missing`() {
        val selected = resolveNewConversationChatModel(
            draftModelId = null,
            stickyModelId = null,
            preferredModelId = modelB.id,
            catalogDefaultModelId = modelA.id,
            availableModels = listOf(modelA, modelB),
        )

        assertEquals(modelB.id, selected?.id)
    }

    @Test
    fun `new conversation ignores unavailable sticky`() {
        val selected = resolveNewConversationChatModel(
            draftModelId = null,
            stickyModelId = "00000000-0000-0000-0000-000000000099",
            preferredModelId = null,
            catalogDefaultModelId = modelA.id,
            availableModels = listOf(modelA, modelB),
        )

        assertEquals(modelA.id, selected?.id)
    }

    @Test
    fun `stale session model falls back to a sendable catalog model`() {
        val selected = resolveConversationChatModel(
            session = ChatSession(
                id = "session",
                currentModelId = "00000000-0000-0000-0000-000000000099",
            ),
            availableModels = listOf(modelA, modelB),
            catalogDefaultModelId = modelB.id,
        )

        assertEquals(modelB.id, selected?.id)
    }
}
