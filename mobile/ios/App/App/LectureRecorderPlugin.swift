import AVFoundation
import Capacitor
import Speech
import UIKit

/// Lecture recording for the iPhone app.
///
/// Records with AVAudioRecorder under the "audio" background mode, so a
/// lecture keeps recording with the screen locked or another app open, and
/// picks up again after a phone call. Audio goes to Documents/lectures as a
/// small AAC file. Transcription runs on the phone with Apple's speech
/// recognizer (on-device when the phone supports it), in one-minute pieces so
/// an hour-long lecture works, and nothing is uploaded by this plugin.
@objc(LectureRecorderPlugin)
public class LectureRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LectureRecorderPlugin"
    public let jsName = "LectureRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transcribe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
    ]

    private var recorder: AVAudioRecorder?
    private var file: String?
    private var pausedByUser = false
    private var interruptionObserver: NSObjectProtocol?

    private static let pieceSeconds: Double = 55

    private var folder: URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = documents.appendingPathComponent("lectures", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// Only a bare file name inside the lectures folder, never a path elsewhere.
    private func audioURL(_ name: String) -> URL? {
        let clean = (name as NSString).lastPathComponent
        guard !clean.isEmpty, clean == name else { return nil }
        return folder.appendingPathComponent(clean)
    }

    deinit {
        if let observer = interruptionObserver { NotificationCenter.default.removeObserver(observer) }
    }

    // MARK: Recording

    @objc func start(_ call: CAPPluginCall) {
        if recorder != nil {
            call.reject("A recording is already running.")
            return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else {
                    call.reject("Megan Study can't use the microphone. Turn it on in Settings → Megan Study → Microphone.", "PERMISSION")
                    return
                }
                self.beginRecording(call)
            }
        }
    }

    private func beginRecording(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
            try session.setActive(true)
        } catch {
            call.reject("Couldn't start the microphone: \(error.localizedDescription)")
            return
        }

        let name = "\(UUID().uuidString.lowercased()).m4a"
        guard let url = audioURL(name) else { return call.reject("Couldn't create the recording file.") }
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 22_050,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 48_000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else {
                call.reject("Couldn't start recording.")
                return
            }
            self.recorder = recorder
            self.file = name
            self.pausedByUser = false
            watchInterruptions()
            call.resolve(["file": name])
        } catch {
            call.reject("Couldn't start recording: \(error.localizedDescription)")
        }
    }

    /// A phone call or Siri pauses the recorder; carry on once it ends,
    /// unless the student had paused it themselves.
    private func watchInterruptions() {
        guard interruptionObserver == nil else { return }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            guard let self = self, let recorder = self.recorder,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .ended && !self.pausedByUser {
                try? AVAudioSession.sharedInstance().setActive(true)
                recorder.record()
                self.notifyListeners("interruption", data: ["resumed": true])
            } else if type == .began {
                self.notifyListeners("interruption", data: ["resumed": false])
            }
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        pausedByUser = true
        recorder?.pause()
        call.resolve(snapshot())
    }

    @objc func resume(_ call: CAPPluginCall) {
        pausedByUser = false
        try? AVAudioSession.sharedInstance().setActive(true)
        recorder?.record()
        call.resolve(snapshot())
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let recorder = recorder, let name = file else {
            call.reject("Nothing is recording.")
            return
        }
        let seconds = recorder.currentTime
        recorder.stop()
        self.recorder = nil
        self.file = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        var duration = seconds
        if let url = audioURL(name) {
            let asset = AVURLAsset(url: url)
            let measured = CMTimeGetSeconds(asset.duration)
            if measured.isFinite && measured > 0 { duration = measured }
        }
        call.resolve(["file": name, "seconds": duration])
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(snapshot())
    }

    private func snapshot() -> [String: Any] {
        guard let recorder = recorder else { return ["recording": false, "paused": false, "seconds": 0, "level": 0] }
        recorder.updateMeters()
        // -60 dB and below is silence; 0 dB is as loud as it gets.
        let level = max(0, min(1, (recorder.averagePower(forChannel: 0) + 60) / 60))
        return [
            "recording": true,
            "paused": !recorder.isRecording,
            "seconds": recorder.currentTime,
            "level": level,
            "file": file ?? "",
        ]
    }

    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let name = call.getString("file"), let url = audioURL(name) else {
            call.reject("No such recording.")
            return
        }
        try? FileManager.default.removeItem(at: url)
        call.resolve()
    }

    // MARK: Transcription

    @objc func transcribe(_ call: CAPPluginCall) {
        guard let name = call.getString("file"), let url = audioURL(name),
              FileManager.default.fileExists(atPath: url.path) else {
            call.reject("That recording isn't on this phone any more.")
            return
        }
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.reject("Megan Study can't use speech recognition. Turn it on in Settings → Megan Study → Speech Recognition.", "PERMISSION")
                return
            }
            let locale = Locale(identifier: call.getString("locale") ?? "en-US")
            guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
                call.reject("Speech recognition isn't available right now. Try again in a moment.")
                return
            }
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let pieces = try self.split(url)
                    self.recognize(pieces, recognizer: recognizer, index: 0, segments: []) { result in
                        for piece in pieces { try? FileManager.default.removeItem(at: piece.url) }
                        switch result {
                        case .success(let segments): call.resolve(["segments": segments, "onDevice": recognizer.supportsOnDeviceRecognition])
                        case .failure(let error): call.reject(error.localizedDescription)
                        }
                    }
                } catch {
                    call.reject("Couldn't read the recording: \(error.localizedDescription)")
                }
            }
        }
    }

    private struct Piece { let url: URL; let offset: Double }

    /// Cuts the recording into short pieces; the recognizer handles about a
    /// minute at a time reliably.
    private func split(_ url: URL) throws -> [Piece] {
        let source = try AVAudioFile(forReading: url)
        let format = source.processingFormat
        let framesPerPiece = AVAudioFrameCount(Self.pieceSeconds * format.sampleRate)
        let temp = FileManager.default.temporaryDirectory
        var pieces: [Piece] = []
        var offset: Double = 0
        while source.framePosition < source.length {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: framesPerPiece) else { break }
            try source.read(into: buffer, frameCount: framesPerPiece)
            if buffer.frameLength == 0 { break }
            let pieceURL = temp.appendingPathComponent("lecture-piece-\(UUID().uuidString).caf")
            let out = try AVAudioFile(forWriting: pieceURL, settings: format.settings)
            try out.write(from: buffer)
            pieces.append(Piece(url: pieceURL, offset: offset))
            offset += Double(buffer.frameLength) / format.sampleRate
        }
        return pieces
    }

    private func recognize(
        _ pieces: [Piece],
        recognizer: SFSpeechRecognizer,
        index: Int,
        segments: [[String: Any]],
        done: @escaping (Result<[[String: Any]], Error>) -> Void
    ) {
        guard index < pieces.count else {
            done(.success(segments))
            return
        }
        notifyListeners("transcribeProgress", data: ["done": index, "total": pieces.count])
        let piece = pieces[index]
        let request = SFSpeechURLRecognitionRequest(url: piece.url)
        request.shouldReportPartialResults = false
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        if #available(iOS 16, *) { request.addsPunctuation = true }

        var finished = false
        recognizer.recognitionTask(with: request) { result, error in
            if finished { return }
            if let result = result, result.isFinal {
                finished = true
                var next = segments
                next.append(contentsOf: self.group(result.bestTranscription, offset: piece.offset, firstId: segments.count))
                self.recognize(pieces, recognizer: recognizer, index: index + 1, segments: next, done: done)
            } else if let error = error {
                finished = true
                // A silent piece reports "no speech"; skip it rather than fail the lecture.
                let code = (error as NSError).code
                if code == 1110 || code == 203 {
                    self.recognize(pieces, recognizer: recognizer, index: index + 1, segments: segments, done: done)
                } else {
                    done(.failure(error))
                }
            }
        }
    }

    /// Words into sentence-sized segments with start and end times, the
    /// shape the desktop stores (`TranscriptSegment`).
    private func group(_ transcription: SFTranscription, offset: Double, firstId: Int) -> [[String: Any]] {
        var out: [[String: Any]] = []
        var words: [String] = []
        var start: Double = 0
        var end: Double = 0
        func flush() {
            guard !words.isEmpty else { return }
            out.append(["id": firstId + out.count, "start": offset + start, "end": offset + end, "text": words.joined(separator: " ")])
            words = []
        }
        for segment in transcription.segments {
            if words.isEmpty { start = segment.timestamp }
            words.append(segment.substring)
            end = segment.timestamp + segment.duration
            let sentenceEnd = segment.substring.last.map { ".?!".contains($0) } ?? false
            if (sentenceEnd && end - start >= 4) || end - start >= 15 { flush() }
        }
        flush()
        return out
    }
}
