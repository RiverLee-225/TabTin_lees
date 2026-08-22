import SwiftUI

/// 「最近打开」横向轨道：对齐工作台 `TaskResourceMiniPreview`。只横滑，竖向跟外层列表走。
struct CloudDocsRecentRail: View {
    let items: [SpaceResource]
    let onOpen: (SpaceResource) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TTSpacing.xs) {
            Text(L10n.CloudDocs.railRecent)
                .font(.tt.captionSemibold)
                .foregroundStyle(.tt.textSecondary)
                .padding(.horizontal, TTSpacing.lg)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TTSpacing.sm + TTSpacing.xxs) {
                    ForEach(items) { item in
                        Button {
                            onOpen(item)
                        } label: {
                            CloudDocsRecentRailCard(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, TTSpacing.lg)
            }
            .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            .scrollClipDisabled()
        }
        .padding(.top, TTSpacing.xs)
        .padding(.bottom, TTSpacing.sm)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L10n.CloudDocs.railRecent)
    }
}

private struct CloudDocsRecentRailCard: View {
    let item: SpaceResource

    private var appKind: TaskResourceAppKind {
        SpaceResource.normalizedType(item.itemType) == "tabdata" ? .tabdata : .tabdoc
    }

    var body: some View {
        let palette = AppHomePalette(appKind: appKind)
        VStack(alignment: .leading, spacing: 6) {
            typePill(accent: palette.accent)

            Text(item.displayTitle)
                .font(.tt.metaSemibold)
                .foregroundStyle(palette.accent)
                .lineLimit(1)

            CloudDocsRecentRailPreview(item: item, appKind: appKind)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(9)
        .frame(width: 140, height: 152, alignment: .topLeading)
        .background(
            palette.accentSoft,
            in: RoundedRectangle(cornerRadius: 15, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .strokeBorder(palette.accent.opacity(0.42), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(item.displayTitle)
    }

    private func typePill(accent: Color) -> some View {
        HStack(spacing: 4) {
            AppIconImage(reference: CloudDocsAppIcon.glyphReference(for: item.itemType), size: 13)
            Text(
                appKind == .tabdata
                    ? L10n.WorkbenchAppHome.tablePreviewType
                    : L10n.WorkbenchAppHome.documentPreviewType
            )
            .font(.tt.captionMedium.weight(.semibold))
            .lineLimit(1)
        }
        .foregroundStyle(accent)
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(.tt.bgBubbleIncoming.opacity(0.78), in: Capsule())
    }
}

private struct CloudDocsRecentRailPreview: View {
    let item: SpaceResource
    let appKind: TaskResourceAppKind

    var body: some View {
        let paper = Color.tt.bgBubbleIncoming.opacity(0.72)
        Group {
            switch CloudDocsPresentation.railPreview(for: item) {
            case .image(let url):
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    default:
                        previewText(
                            appKind == .tabdata
                                ? L10n.WorkbenchAppHome.tableRowsUnavailable
                                : L10n.WorkbenchAppHome.documentPreviewUnavailable
                        )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            case .text(let text):
                previewText(text)
            case .empty:
                previewText(
                    appKind == .tabdata
                        ? L10n.WorkbenchAppHome.tableRowsUnavailable
                        : L10n.WorkbenchAppHome.documentPreviewUnavailable
                )
            }
        }
        .padding(7)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func previewText(_ text: String) -> some View {
        Text(text)
            .font(.tt.caption)
            .foregroundStyle(.tt.textSecondary)
            .multilineTextAlignment(.leading)
            .lineSpacing(2)
            .lineLimit(3)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct CloudDocsSectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack(spacing: TTSpacing.xs) {
            Text(title)
            Text("\(count)")
        }
        .font(.tt.captionSemibold)
        .foregroundStyle(.tt.textSecondary)
        .textCase(nil)
    }
}

struct CloudDocsBrowseEmptyState: View {
    let title: String
    let subtitle: String?
    var showsCreateAction: Bool = false
    var canCreate: Bool = true
    var isCreating: Bool = false
    var onCreate: ((CloudDocsCreatableKind) -> Void)?

    var body: some View {
        VStack(spacing: TTSpacing.md) {
            CloudDocsAppIcon(itemType: "tabdoc", size: TTSpacing.huge)
            Text(title)
                .font(.tt.bodySemibold)
                .foregroundStyle(.tt.textPrimary)
                .multilineTextAlignment(.center)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.tt.captionMedium)
                    .foregroundStyle(.tt.textSecondary)
                    .multilineTextAlignment(.center)
            }
            if showsCreateAction {
                Menu {
                    ForEach(CloudDocsCreatableKind.enabledKinds) { kind in
                        Button {
                            onCreate?(kind)
                        } label: {
                            Label {
                                Text(kind.title)
                            } icon: {
                                AppIconImage(reference: kind.iconReference, size: 20)
                            }
                        }
                        .disabled(!canCreate || isCreating)
                    }
                } label: {
                    Text(L10n.Common.create)
                        .font(.tt.bodySemibold)
                        .foregroundStyle(.tt.textOnAccent)
                        .padding(.horizontal, TTSpacing.xl)
                        .frame(minHeight: TTSpacing.Control.minimumTouchTarget)
                        .background(.tt.bgAccent, in: Capsule())
                }
                .disabled(!canCreate || isCreating)
                .accessibilityLabel(L10n.Common.create)
            }
        }
    }
}
