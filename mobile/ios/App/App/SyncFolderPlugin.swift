import Capacitor
import UIKit
import UniformTypeIdentifiers

/// The folder the iPhone app syncs decks through (see
/// packages/core/src/sync/folder-sync.ts): one the student picks in Files,
/// normally "Megan Study Sync" in iCloud Drive, which the Mac app also uses.
///
/// The choice is kept as a security-scoped bookmark so it survives restarts.
/// Reads and writes go through NSFileCoordinator, as iCloud Drive asks, and
/// files iCloud hasn't downloaded yet are asked for so they're there next
/// time. Only bare file names inside the folder are ever touched.
@objc(SyncFolderPlugin)
public class SyncFolderPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "SyncFolderPlugin"
    public let jsName = "SyncFolder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    private static let bookmarkKey = "megan.syncFolderBookmark"
    private var pickCall: CAPPluginCall?
    private let queue = DispatchQueue(label: "megan.sync-folder")

    // MARK: Choosing the folder

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("The folder picker couldn't open.")
                return
            }
            self.pickCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall else { return }
        pickCall = nil
        guard let url = urls.first else {
            call.resolve(["name": NSNull()])
            return
        }
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        do {
            let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(bookmark, forKey: SyncFolderPlugin.bookmarkKey)
            call.resolve(["name": url.lastPathComponent])
        } catch {
            call.reject("That folder can't be used. Choose another.")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.resolve(["name": NSNull()])
        pickCall = nil
    }

    @objc func current(_ call: CAPPluginCall) {
        guard let url = folderURL() else {
            call.resolve(["name": NSNull()])
            return
        }
        call.resolve(["name": url.lastPathComponent])
    }

    @objc func clear(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: SyncFolderPlugin.bookmarkKey)
        call.resolve()
    }

    /// The saved folder, refreshing a stale bookmark as it goes.
    private func folderURL() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: SyncFolderPlugin.bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
            return nil
        }
        if stale {
            let accessing = url.startAccessingSecurityScopedResource()
            if let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                UserDefaults.standard.set(fresh, forKey: SyncFolderPlugin.bookmarkKey)
            }
            if accessing { url.stopAccessingSecurityScopedResource() }
        }
        return url
    }

    /// Runs `work` with the folder opened, off the main thread.
    private func withFolder(_ call: CAPPluginCall, _ work: @escaping (URL) throws -> Void) {
        queue.async {
            guard let folder = self.folderURL() else {
                call.reject("No sync folder is chosen.")
                return
            }
            let accessing = folder.startAccessingSecurityScopedResource()
            defer { if accessing { folder.stopAccessingSecurityScopedResource() } }
            do {
                try work(folder)
            } catch {
                call.reject("The sync folder can't be reached right now.")
            }
        }
    }

    private func fileURL(_ folder: URL, _ name: String?) -> URL? {
        guard let name = name else { return nil }
        let clean = (name as NSString).lastPathComponent
        guard !clean.isEmpty, clean == name, !clean.hasPrefix(".") else { return nil }
        return folder.appendingPathComponent(clean)
    }

    // MARK: Files

    @objc func list(_ call: CAPPluginCall) {
        withFolder(call) { folder in
            var failure: NSError?
            var names: [String] = []
            var listError: Error?
            NSFileCoordinator().coordinate(readingItemAt: folder, options: [], error: &failure) { url in
                do {
                    names = try FileManager.default.contentsOfDirectory(atPath: url.path)
                } catch {
                    listError = error
                }
            }
            if let error = failure ?? listError { throw error }
            var files: [String] = []
            for name in names {
                // ".deck.json.icloud" is a file iCloud hasn't brought down yet.
                if name.hasPrefix("."), name.hasSuffix(".icloud") {
                    let real = String(name.dropFirst().dropLast(".icloud".count))
                    try? FileManager.default.startDownloadingUbiquitousItem(at: folder.appendingPathComponent(real))
                } else if !name.hasPrefix(".") {
                    files.append(name)
                }
            }
            call.resolve(["names": files])
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        withFolder(call) { folder in
            guard let file = self.fileURL(folder, call.getString("name")) else {
                call.reject("Not a file in the sync folder.")
                return
            }
            var failure: NSError?
            var text: String?
            NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: &failure) { url in
                text = try? String(contentsOf: url, encoding: .utf8)
            }
            call.resolve(["text": text ?? NSNull()])
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        withFolder(call) { folder in
            guard let file = self.fileURL(folder, call.getString("name")), let text = call.getString("text") else {
                call.reject("Not a file in the sync folder.")
                return
            }
            var failure: NSError?
            var writeError: Error?
            NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: &failure) { url in
                do {
                    try text.write(to: url, atomically: true, encoding: .utf8)
                } catch {
                    writeError = error
                }
            }
            if let error = failure ?? writeError { throw error }
            call.resolve()
        }
    }
}
