import Foundation

struct CloudDocsSharerAvatar: Equatable {
    let name: String
    let seed: String
    let imageUrl: String?
}

enum CloudDocsRailPreview: Equatable {
    case image(URL)
    case text(String)
    case empty
}

/// 「全部」树拆成文件夹 / 文件两段。子行跟着父文件夹走，不提到文件段。
struct CloudDocsTreeSections: Equatable {
    var folders: [KnowledgeTreeFlatRow] = []
    var documents: [KnowledgeTreeFlatRow] = []
    var folderCount: Int = 0
    var documentCount: Int = 0

    var isEmpty: Bool { folders.isEmpty && documents.isEmpty }
}

/// 云文档列表行上的修改时间文案、合并元信息和分享人头像。
enum CloudDocsPresentation {
    static let metaSeparator = " · "

    static func lastModified(_ raw: String?) -> String? {
        guard let value = relativeTime(raw) else { return nil }
        return L10n.CloudDocs.recentlyModifiedAt(value)
    }

    static func relativeTime(_ raw: String?) -> String? {
        raw.flatMap { RelativeTime.format($0) }
    }

    /// `时间 · 成员 · 类型`：缺段就省略，不留下多余分隔符。
    static func mergedMeta(time: String?, member: String?, type: String?) -> String? {
        let parts = [time, member, type].compactMap { part -> String? in
            guard let trimmed = part?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !trimmed.isEmpty else { return nil }
            return trimmed
        }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: metaSeparator)
    }

    /// 最近打开卡片预览：缩略图优先，其次正文摘要；签名 URL 不当文字露出。
    /// 表格的「N 行 · M 字段」是建表时冻结的计数快照，0/0 不当内容展示；
    /// 有字段名时用字段名，避免卡片一直停在「0 行 · 0 字段」。
    static func railPreview(for resource: SpaceResource) -> CloudDocsRailPreview {
        if let url = imageURL(resource.thumbnailURL) ?? imageURL(resource.preview) {
            return .image(url)
        }
        if SpaceResource.normalizedType(resource.itemType) == "tabdata" {
            let names = tableFieldNames(resource.metadata)
            if !names.isEmpty {
                return .text(names.joined(separator: " | "))
            }
        }
        if let text = previewText(resource.preview) {
            if isZeroStatsFallback(text) {
                return .empty
            }
            return .text(text)
        }
        return .empty
    }

    static func typeLabel(forItemType itemType: String) -> String? {
        switch SpaceResource.normalizedType(itemType) {
        case "tabdoc": return L10n.CloudDocs.typeDocument
        case "tabdata": return L10n.CloudDocs.typeTable
        default: return nil
        }
    }

    static func treeSections(from rows: [KnowledgeTreeFlatRow]) -> CloudDocsTreeSections {
        var sections = CloudDocsTreeSections()
        var appendingToFolders = false
        for row in rows {
            if row.depth == 0 {
                if row.isExpandable {
                    appendingToFolders = true
                    sections.folderCount += 1
                    sections.folders.append(row)
                } else {
                    appendingToFolders = false
                    sections.documentCount += 1
                    sections.documents.append(row)
                }
            } else if appendingToFolders {
                sections.folders.append(row)
            } else {
                sections.documents.append(row)
            }
        }
        return sections
    }

    static func sharerAvatar(_ owner: SharedResourceOwner?) -> CloudDocsSharerAvatar? {
        guard let owner else { return nil }
        let name = owner.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = owner.id.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAvatar = owner.avatar?.trimmingCharacters(in: .whitespacesAndNewlines)
        let imageUrl = (trimmedAvatar?.isEmpty == false) ? trimmedAvatar : nil
        guard !name.isEmpty || !id.isEmpty || imageUrl != nil else { return nil }
        return CloudDocsSharerAvatar(
            name: name.isEmpty ? "?" : name,
            seed: IdentityAvatar.colorSeed(id, fallbackName: name),
            imageUrl: imageUrl
        )
    }

    private static func imageURL(_ raw: String?) -> URL? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
              let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else { return nil }
        return url
    }

    private static func previewText(_ raw: String?) -> String? {
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        let lowered = text.lowercased()
        guard !lowered.hasPrefix("http://"),
              !lowered.hasPrefix("https://"),
              !lowered.hasPrefix("//"),
              !lowered.hasPrefix("data:"),
              !lowered.hasPrefix("blob:") else { return nil }
        return text
    }

    private static let statsPreviewPattern = try! NSRegularExpression(
        pattern: #"^\d+\s+(?:行|rows?)\s*[·•]\s*\d+\s+(?:字段|fields?)$"#,
        options: [.caseInsensitive]
    )

    private static func isZeroStatsFallback(_ text: String) -> Bool {
        let range = NSRange(text.startIndex..., in: text)
        guard statsPreviewPattern.firstMatch(in: text, options: [], range: range) != nil else {
            return false
        }
        let numbers = text.split { !$0.isNumber }.compactMap { Int($0) }
        return numbers.count >= 2 && numbers[0] == 0 && numbers[1] == 0
    }

    private static func tableFieldNames(_ metadata: [String: AnyCodable]?) -> [String] {
        guard let raw = metadata?["field_names"]?.value else { return [] }
        let items: [Any]
        if let array = raw as? [Any] {
            items = array
        } else if let boxed = raw as? [AnyCodable] {
            items = boxed.map(\.value)
        } else {
            return []
        }
        return items.compactMap { item in
            let text: String
            if let string = item as? String {
                text = string
            } else if let number = item as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
                text = number.stringValue
            } else {
                return nil
            }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
    }
}
