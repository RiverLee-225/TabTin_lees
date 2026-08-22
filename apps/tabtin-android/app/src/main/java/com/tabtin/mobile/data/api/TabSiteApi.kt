package com.tabtin.mobile.data.api

import com.tabtin.mobile.data.model.ApiEnvelope
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Path

@Serializable
public data class TabSiteDetail(
    val id: String = "",
    val name: String = "",
    val status: String = "draft",
    @SerialName("published_url") val publishedUrl: String = "",
    @SerialName("dist_oss_url") val distOssUrl: String = "",
)

public interface TabSiteApi {
    @GET("tabsite/sites/{siteId}/")
    public suspend fun getSite(
        @Path("siteId") siteId: String,
    ): ApiEnvelope<TabSiteDetail>
}
