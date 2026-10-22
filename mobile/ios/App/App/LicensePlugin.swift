import Capacitor
import CryptoKit
import Foundation

/// Checks a license key's signature for packages/core/src/license/companion.ts.
/// iOS 15 has no Ed25519 in WebCrypto, so the check runs here with CryptoKit,
/// against the same public key electron/license/verify.cjs uses. Nothing
/// else about the key is decided natively.
@objc(LicensePlugin)
public class LicensePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LicensePlugin"
    public let jsName = "License"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "verify", returnType: CAPPluginReturnPromise),
    ]

    /// The publisher's Ed25519 public key (SPKI, base64). The raw key is the last 32 bytes.
    private static let publicKeySpki = "MCowBQYDK2VwAyEAg/F/SrMCdmyr4xlr16viMJPRd2UGV2L833xMM4pUjAs="

    private static let publicKey: Curve25519.Signing.PublicKey? = {
        guard let der = Data(base64Encoded: publicKeySpki), der.count == 44 else { return nil }
        return try? Curve25519.Signing.PublicKey(rawRepresentation: der.suffix(32))
    }()

    @objc func verify(_ call: CAPPluginCall) {
        guard
            let signedText = call.getString("signedBytes"),
            let signatureText = call.getString("signature"),
            let signed = Data(base64Encoded: signedText),
            let signature = Data(base64Encoded: signatureText),
            let key = LicensePlugin.publicKey
        else {
            call.resolve(["valid": false])
            return
        }
        call.resolve(["valid": key.isValidSignature(signature, for: signed)])
    }
}
