package com.tabtin.mobile.features.clouddocs

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.tabtin.mobile.data.model.SharedResourceOwner
import com.tabtin.mobile.data.model.SpaceResource
import com.tabtin.mobile.ui.theme.IdentityAvatar
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, qualifiers = "zh-rCN")
class CloudDocsPresentationTest {
    @Test
    fun lastModified_prefixesParsedOffsetTimestamp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val label = CloudDocsPresentation.lastModified(context, "2026-07-20T00:00:00+00:00")
        assertNotNull(label)
        assertTrue(label!!.startsWith("最近修改："))
    }

    @Test
    fun lastModified_blankTimestampIsHidden() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertNull(CloudDocsPresentation.lastModified(context, null))
        assertNull(CloudDocsPresentation.lastModified(context, "not-a-date"))
    }

    @Test
    fun sharerAvatar_keepsColorWhenDisplayNameChanges() {
        val userId = "05a81772-b342-4590-a4a1-ed423f5e1a4d"
        val renamed = CloudDocsPresentation.sharerAvatar(
            SharedResourceOwner(id = userId, displayName = "林工（已离职）", avatar = "https://cdn.example/a.png"),
        )
        assertNotNull(renamed)
        assertEquals(userId, renamed!!.seed)
        assertEquals(IdentityAvatar.colorSeed(userId, "林工"), renamed.seed)
        assertEquals("https://cdn.example/a.png", renamed.imageUrl)
    }

    @Test
    fun sharerAvatar_ignoresEmptyOwner() {
        assertNull(CloudDocsPresentation.sharerAvatar(null))
        assertNull(CloudDocsPresentation.sharerAvatar(SharedResourceOwner()))
    }

    @Test
    fun mergedMeta_joinsPresentParts() {
        assertEquals(
            "10 分钟前 · 张迟 · 文档",
            CloudDocsPresentation.mergedMeta("10 分钟前", "张迟", "文档"),
        )
    }

    @Test
    fun mergedMeta_omitsMissingPartsAndExtraSeparators() {
        assertEquals("昨天 · 表格", CloudDocsPresentation.mergedMeta("昨天", null, "表格"))
        assertEquals("文档", CloudDocsPresentation.mergedMeta(null, "  ", "文档"))
        assertEquals("李雨思", CloudDocsPresentation.mergedMeta("", "李雨思", null))
        assertNull(CloudDocsPresentation.mergedMeta(null, "", "   "))
        assertNull(CloudDocsPresentation.mergedMeta(null, null, null))
    }

    @Test
    fun railPreview_prefersCoverImageOverText() {
        val resource = SpaceResource(
            id = "item-1",
            itemType = "tabdoc",
            title = "文档",
            preview = "正文摘要",
            resourceId = "doc-1",
            metadata = buildJsonObject { put("cover_image", "https://cdn.example/cover.png") },
        )
        assertEquals(
            CloudDocsRailPreview.Image("https://cdn.example/cover.png"),
            CloudDocsPresentation.railPreview(resource),
        )
    }

    @Test
    fun railPreview_usesTextExcerpt() {
        val resource = SpaceResource(
            id = "item-1",
            itemType = "tabdoc",
            title = "文档",
            preview = "会议纪要第一段",
            resourceId = "doc-1",
        )
        assertEquals(
            CloudDocsRailPreview.Text("会议纪要第一段"),
            CloudDocsPresentation.railPreview(resource),
        )
    }

    @Test
    fun railPreview_doesNotShowSignedUrlAsText() {
        val https = SpaceResource(
            id = "item-1",
            itemType = "tabdoc",
            title = "文档",
            preview = "https://cdn.example/signed?X-Amz-Signature=abc",
            resourceId = "doc-1",
        )
        assertEquals(
            CloudDocsRailPreview.Image("https://cdn.example/signed?X-Amz-Signature=abc"),
            CloudDocsPresentation.railPreview(https),
        )

        val data = SpaceResource(
            id = "item-2",
            itemType = "tabdoc",
            title = "文档",
            preview = "data:text/plain,hello",
            resourceId = "doc-2",
        )
        assertEquals(CloudDocsRailPreview.Empty, CloudDocsPresentation.railPreview(data))

        val relativeCover = SpaceResource(
            id = "item-3",
            itemType = "tabdoc",
            title = "文档",
            preview = "字段摘要",
            resourceId = "doc-3",
            metadata = buildJsonObject { put("cover_image", "/media/cover.png") },
        )
        assertEquals(
            CloudDocsRailPreview.Text("字段摘要"),
            CloudDocsPresentation.railPreview(relativeCover),
        )
    }

    @Test
    fun railPreview_emptyWithoutSafeContent() {
        val blank = SpaceResource(
            id = "item-1",
            itemType = "tabdoc",
            title = "文档",
            preview = "   ",
            resourceId = "doc-1",
        )
        assertEquals(CloudDocsRailPreview.Empty, CloudDocsPresentation.railPreview(blank))
        assertEquals(
            CloudDocsRailPreview.Empty,
            CloudDocsPresentation.railPreview(
                SpaceResource(id = "item-2", itemType = "tabdoc", resourceId = "doc-2"),
            ),
        )
    }

    @Test
    fun railPreview_prefersTableFieldNamesOverZeroStats() {
        val resource = SpaceResource(
            id = "item-1",
            itemType = "tabdata",
            title = "表",
            preview = "0 行 · 0 字段",
            resourceId = "table-1",
            metadata = buildJsonObject {
                put(
                    "field_names",
                    buildJsonArray {
                        add("标题")
                        add("状态")
                    },
                )
            },
        )
        assertEquals(
            CloudDocsRailPreview.Text("标题 | 状态"),
            CloudDocsPresentation.railPreview(resource),
        )
    }

    @Test
    fun railPreview_hidesZeroTableStatsSnapshot() {
        val resource = SpaceResource(
            id = "item-1",
            itemType = "tabdata",
            title = "表",
            preview = "0 行 · 0 字段",
            resourceId = "table-1",
        )
        assertEquals(CloudDocsRailPreview.Empty, CloudDocsPresentation.railPreview(resource))
    }
}
