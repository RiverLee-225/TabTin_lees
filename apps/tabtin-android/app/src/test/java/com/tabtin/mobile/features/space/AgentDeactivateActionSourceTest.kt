package com.tabtin.mobile.features.space

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AgentDeactivateActionSourceTest {
    @Test
    fun `deactivate action stays at detail root instead of a section tab`() {
        val source = File(
            "src/main/java/com/tabtin/mobile/features/space/AgentDetailScreen.kt",
        ).readText()
        val detailBody = source.substringAfter("private fun AgentDetailContent(")
            .substringBefore("private fun IdentityCard(")

        assertTrue(detailBody.contains("if (agent.isDefault != true)"))
        // 详情页不再用标签分区，四个区都常驻；标签一回来就可能把「停用」重新藏起来。
        assertFalse(source.contains("AgentDetailTabRow"))
    }
}
