import Capacitor
import UIKit

/// The app's web view, with the plugins that live in this project registered.
class MeganBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LectureRecorderPlugin())
        bridge?.registerPluginInstance(SyncFolderPlugin())
    }
}
