import SwiftUI

/// 云文档资源类型图标。
///
/// 用无白底内容字形（`AppGlyphTabdoc` / `AppGlyphTabdata`），不是带底座的完整 App icon，
/// 也不是 emoji / 主题色 SF Symbol。缺字形时才退回 SF Symbol。
///
/// `itemType` 容忍后端各路别名（tabdoc / doc / document、tabdata / table）：
/// 分享给我的资源用的是 `SharedResourceType` 的 doc / table，知识树用的是 tabdoc / tabdata，
/// 这里统一先经 `SpaceResource.normalizedType` 归一再找资产，否则别名会全部掉进 fallback。
struct CloudDocsAppIcon: View {
    /// 列表行里的标准类型底座边长。行的分隔线缩进要按它算，所以是具名常量而非字面量。
    static let defaultSize: CGFloat = 40

    let itemType: String
    var size: CGFloat = CloudDocsAppIcon.defaultSize

    var body: some View {
        ZStack {
            Circle()
                .fill(Self.backgroundColor(for: itemType))

            AppIconImage(reference: reference, size: size * 0.55)
        }
        .frame(width: size, height: size)
    }

    private var normalizedType: String { SpaceResource.normalizedType(itemType) }

    static func backgroundColor(for itemType: String) -> Color {
        SpaceResource.normalizedType(itemType) == "tabdata" ? .tt.bgCloudTableIcon : .tt.bgCloudDocIcon
    }

    static func accentColor(for itemType: String) -> Color {
        SpaceResource.normalizedType(itemType) == "tabdata" ? .tt.accentCloudTable : .tt.accentCloudDoc
    }

    static func glyphReference(for itemType: String) -> AppIconReference {
        let appId = SpaceResource.normalizedType(itemType)
        return AppIconResolver.resolveContentGlyph(
            appId: appId,
            manifestIcon: SpaceResource.icon(forType: appId)
        )
    }

    private var reference: AppIconReference {
        Self.glyphReference(for: itemType)
    }
}

/// 云文档列表的统一行，三个分段共用。
///
/// 解剖：圆形图标 + 标题 / 合并元信息 + 置顶。时间、成员、类型合成一行副标题，
/// 不再占行尾固定列，避免把标题挤窄。
///
/// - 知识树：传 `depth` 做层级缩进，传 `isExpandable` / `isExpanded` 出展开箭头。
/// - 最近 / 分享：`reservesDisclosureSpace` 传 `false` 让图标贴左。
///
/// 行本身不带点击手势——外层负责「打开资源」，这里只暴露展开箭头的回调，
/// 避免两层手势在同一块区域打架。
struct CloudDocsRow: View {
    let title: String
    let itemType: String
    /// 标题下方的第二行，已由调用方合成（时间 · 成员 · 类型，或搜索路径）。
    let subtitle: String?
    /// 「分享给我」才传：排成「由 [头像] 名字 分享」，再接 `subtitle` 的其余段。
    var sharer: CloudDocsSharerAvatar? = nil
    var depth: Int = 0
    var isPinned: Bool = false
    var isExpandable: Bool = false
    var isExpanded: Bool = false
    var isLoadingChildren: Bool = false
    /// 仅当该行需要保持展开列对齐时才占住该列。叶子节点不预留，避免“全部”页
    /// 的文档图标相对最近 / 分享页无意义地右移。
    var reservesDisclosureSpace: Bool = true
    var onToggleExpand: (() -> Void)?

    /// HIG 最小点击热区。只用于按钮类子元素，不当行高使——两者语义不同，
    /// 行高按 demo 走 48pt。
    private static let minHitSize: CGFloat = 44

    /// 40pt 类型底座配两行文字，保持足够的上下呼吸空间。
    private static let minRowHeight: CGFloat = 64

    /// 展开箭头这一列的宽度，对齐 demo 的 `.row-chevron { width: 20px }`。
    /// 不复用 `TTSpacing.xl`——那是间距语义，设计师调间距不该连带改这里的列宽。
    static let disclosureWidth: CGFloat = 20

    /// 行内左右内边距，对齐 demo 的 `.row { padding: 8px 12px }`。
    static let horizontalPadding: CGFloat = TTSpacing.md

    fileprivate static let sharerAvatarSize: CGFloat = 18

    /// 根行分隔线从标题文字处起（无展开列时：12 + 40 + 8）。
    static let separatorLeadingInset: CGFloat = 60

    /// 子行分隔线对齐文字起点，demo 为 ~92px。
    static let childSeparatorLeadingInset: CGFloat = 92

    static func separatorLeadingInset(depth: Int, reservesDisclosureSpace: Bool) -> CGFloat {
        if depth > 0 {
            return childSeparatorLeadingInset + CGFloat(depth - 1) * TTSpacing.lg
        }
        if reservesDisclosureSpace {
            return horizontalPadding + disclosureWidth + TTSpacing.sm
                + CloudDocsAppIcon.defaultSize + TTSpacing.sm
        }
        return separatorLeadingInset
    }

    /// 每层缩进一个 `lg`，与 Electron 知识树同步。
    private var indent: CGFloat { CGFloat(depth) * TTSpacing.lg }

    var body: some View {
        HStack(spacing: TTSpacing.sm) {
            disclosure

            CloudDocsAppIcon(itemType: itemType)

            VStack(alignment: .leading, spacing: TTSpacing.xxs) {
                Text(title)
                    .font(.tt.subtitleSemibold)
                    .foregroundStyle(.tt.textPrimary)
                    .lineLimit(1)
                secondaryLine
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TTSpacing.xs)

            if isPinned {
                Image(systemName: "pin.fill")
                    .font(.tt.iconCaptionMedium)
                    .foregroundStyle(.tt.iconAccent)
                    .accessibilityLabel(L10n.CloudDocs.actionPin)
            }
        }
        .padding(.horizontal, Self.horizontalPadding)
        .padding(.leading, indent)
        .frame(minHeight: Self.minRowHeight)
        .overlay(alignment: .leading) {
            if depth > 0 {
                Rectangle()
                    .fill(Color.tt.borderLight)
                    .frame(width: 1)
                    .padding(.leading, Self.guideLineLeading(depth: depth))
                    .padding(.vertical, TTSpacing.xs)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var secondaryLine: some View {
        if let sharer {
            HStack(spacing: TTSpacing.xxs) {
                CloudDocsSharedByLine(sharer: sharer)
                if let subtitle, !subtitle.isEmpty {
                    Text(CloudDocsPresentation.metaSeparator.trimmingCharacters(in: .whitespaces))
                    Text(subtitle)
                        .lineLimit(1)
                }
            }
            .font(.tt.captionMedium)
            .foregroundStyle(.tt.textTertiary)
        } else if let subtitle, !subtitle.isEmpty {
            Text(subtitle)
                .font(.tt.captionMedium)
                .foregroundStyle(.tt.textTertiary)
                .lineLimit(1)
        }
    }

    private static func guideLineLeading(depth: Int) -> CGFloat {
        horizontalPadding
            + CGFloat(max(depth - 1, 0)) * TTSpacing.lg
            + disclosureWidth
            + TTSpacing.sm
    }

    @ViewBuilder
    private var disclosure: some View {
        if isExpandable {
            Button {
                onToggleExpand?()
            } label: {
                Group {
                    if isLoadingChildren {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "chevron.right")
                            .font(.tt.iconCaption)
                            .foregroundStyle(.tt.textTertiary)
                            .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    }
                }
                .frame(width: Self.disclosureWidth, height: Self.minHitSize)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isExpanded ? L10n.CloudDocs.collapse : L10n.CloudDocs.expand)
        } else if reservesDisclosureSpace {
            Color.clear.frame(width: Self.disclosureWidth, height: Self.minHitSize)
        }
    }
}

private struct CloudDocsSharedByLine: View {
    let sharer: CloudDocsSharerAvatar

    var body: some View {
        HStack(spacing: TTSpacing.xxs) {
            Text(L10n.CloudDocs.sharedByPrefix)
            IdentityColorAvatar(
                name: sharer.name,
                seed: sharer.seed,
                imageUrl: sharer.imageUrl,
                size: CloudDocsRow.sharerAvatarSize
            )
            Text(sharer.name)
                .lineLimit(1)
            if !L10n.CloudDocs.sharedBySuffix.isEmpty {
                Text(L10n.CloudDocs.sharedBySuffix)
            }
        }
        .font(.tt.captionMedium)
        .foregroundStyle(.tt.textTertiary)
    }
}
