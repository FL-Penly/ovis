import UIKit
import WebKit
import Capacitor

/// The PCs this app knows, kept in UserDefaults. The WebView's cookies (a paired device's
/// sign-in) live in WebKit's own store, not here.
enum PCStore {
    private static let defaults = UserDefaults.standard

    /// Origins opened before, the latest first.
    static var saved: [String] {
        get { defaults.stringArray(forKey: "herdr.saved") ?? [] }
        set { defaults.set(newValue, forKey: "herdr.saved") }
    }

    /// The PC the app opens at launch, an origin; nil shows the connect screen.
    static var current: String? {
        get { defaults.string(forKey: "herdr.current") }
        set { defaults.set(newValue, forKey: "herdr.current") }
    }

    /// The PC opened last, even after "Change PC", for the pages that name it.
    static var last: String? {
        get { defaults.string(forKey: "herdr.last") }
        set { defaults.set(newValue, forKey: "herdr.last") }
    }

    /// The address to open instead of the bare origin until a PC page loads: a pairing link keeps
    /// its `?pair=` code through Try again. In memory only, as it can hold that code.
    static var pendingStart: String?

    /// Why the last load failed, for the error page.
    static var failure: String?

    static func remember(_ origin: String) {
        saved = [origin] + saved.filter { $0 != origin }
    }

    static func forget(_ origin: String) {
        saved = saved.filter { $0 != origin }
        if current == origin { current = nil }
        if last == origin { last = nil }
    }

    /// `scheme://host[:port]` of an http or https URL, the host in lowercase as WebKit reports it, or nil.
    static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        let shownHost = host.contains(":") ? "[\(host)]" : host
        return url.port.map { "\(scheme)://\(shownHost):\($0)" } ?? "\(scheme)://\(shownHost)"
    }
}

/// Capacitor's view controller with the chosen PC as the WebView's first page. Reaching the PC
/// by navigating from the bundled connect page instead would cost every launch about 1.5 s
/// (docs/native-app.md, Spike results), so opening a PC builds a new one of these.
class HerdrBridgeViewController: CAPBridgeViewController {
    private var failureProxy: NavigationFailureProxy?
    /// Covers the web view, which stays blank until the PC's page has loaded.
    private var openingView: UIView?
    /// Gives up on a PC that has not answered, instead of WebKit's own wait of a minute or more.
    private var answerTimeout: DispatchWorkItem?
    /// How long a PC may take to answer the first request.
    private static let answerSeconds = 20

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let origin = PCStore.current, let host = URL(string: origin)?.host {
            // what server.url sets; the pairing link until a PC page has loaded, the origin after it
            descriptor.serverURL = PCStore.pendingStart ?? origin + "/"
            // the whole PC is the app: its own links stay in the WebView, others go to Safari
            descriptor.allowedNavigationHostnames = descriptor.allowedNavigationHostnames + [host]
        }
        return descriptor
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        // a PC on a plain http address (a tailnet or LAN IP) is opened as typed: with the system's
        // https-first try, every load of one waited about 2 s before it started
        configuration.upgradeKnownHostsToHTTPS = false
        if #available(iOS 18.2, *) {
            configuration.defaultWebpagePreferences.preferredHTTPSNavigationPolicy = .keepAsRequested
        }
        return configuration
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HerdrShellPlugin())
        bridge?.registerPluginInstance(OvisPushPlugin())
    }

    override func viewDidLoad() {
        // before super, which starts the first load
        if let webView = webView, PCStore.current != nil {
            let proxy = NavigationFailureProxy(inner: webView.navigationDelegate) { [weak self] webView, reason in
                self?.showFailure(in: webView, reason: reason)
            }
            proxy.onAnswer = { [weak self] in self?.answerTimeout?.cancel() }
            proxy.onLoaded = { [weak self] in self?.hideOpening() }
            failureProxy = proxy
            webView.navigationDelegate = proxy
        }
        super.viewDidLoad()
        if let webView = webView, let origin = PCStore.current {
            showOpening(origin)
            let timeout = DispatchWorkItem { [weak self, weak webView] in
                guard let self, let webView else { return }
                // stopping ends the load as cancelled, which the proxy does not report again
                webView.stopLoading()
                let host = URL(string: origin)?.host ?? origin
                self.showFailure(in: webView, reason: Self.korean
                    ? "\(host)이(가) \(Self.answerSeconds)초 안에 응답하지 않았습니다."
                    : "\(host) did not answer within \(Self.answerSeconds) seconds.")
            }
            answerTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(Self.answerSeconds), execute: timeout)
        }
    }

    private static var korean: Bool { Locale.preferredLanguages.first?.lowercased().hasPrefix("ko") ?? false }

    /// What shows while a PC opens: which PC, and Change PC, so a PC that never answers does not
    /// leave a blank screen.
    private func showOpening(_ origin: String) {
        let host = URL(string: origin)?.host ?? origin
        let cover = UIView(frame: view.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.backgroundColor = UIColor(red: 0x12 / 255, green: 0x10 / 255, blue: 0x0e / 255, alpha: 1)

        let spinner = UIActivityIndicatorView(style: .large)
        spinner.color = .white
        spinner.startAnimating()
        let label = UILabel()
        label.text = Self.korean ? "\(host) 여는 중…" : "Opening \(host)…"
        label.textColor = UIColor(white: 0.85, alpha: 1)
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        let change = UIButton(type: .system, primaryAction: UIAction(title: Self.korean ? "PC 바꾸기" : "Change PC") { _ in
            PCStore.current = nil
            HerdrBridgeViewController.reopen()
        })
        change.tintColor = .white
        change.titleLabel?.font = .preferredFont(forTextStyle: .body)

        let stack = UIStackView(arrangedSubviews: [spinner, label, change])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: cover.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: cover.safeAreaLayoutGuide.trailingAnchor, constant: -24)
        ])
        view.addSubview(cover)
        openingView = cover
    }

    private func hideOpening() {
        answerTimeout?.cancel()
        openingView?.removeFromSuperview()
        openingView = nil
    }

    private func showFailure(in webView: WKWebView, reason: String) {
        guard let local = bridge?.config.localURL else { return }
        answerTimeout?.cancel()
        PCStore.failure = reason
        webView.load(URLRequest(url: local.appendingPathComponent("error.html")))
    }

    /// Replaces the app's view controller, so the next page (a PC, or the connect screen) is a
    /// first load. The old one goes with its web view and the page in it (the barcode scanner
    /// plugin, which kept it alive, is patched in app/patches).
    static func reopen() {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard let window = (scene?.delegate as? SceneDelegate)?.window else { return }
        window.rootViewController = HerdrBridgeViewController()
    }
}

/// Passes every navigation callback to Capacitor's own delegate and reports a main-frame load
/// that failed, such as a PC that is off or one that answers with an HTTP error, with its reason.
/// A load cancelled on purpose (a link handed to Safari, a new navigation) is not a failure.
final class NavigationFailureProxy: NSObject, WKNavigationDelegate {
    private weak var inner: WKNavigationDelegate?
    private let onFailure: (WKWebView, String) -> Void
    /// The first page's server answered, with any status.
    var onAnswer: (() -> Void)?
    /// A page (the PC's or the error page) finished loading.
    var onLoaded: (() -> Void)?

    init(inner: WKNavigationDelegate?, onFailure: @escaping (WKWebView, String) -> Void) {
        self.inner = inner
        self.onFailure = onFailure
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        inner?.responds(to: aSelector) == true ? inner : nil
    }

    /// A main-frame HTTP error (tailscale serve's 502 while Ovis is stopped on the PC, a 404) is
    /// not a PC worth keeping, and its page would leave the app no way back: the error page shows
    /// instead. Capacitor's delegate does not decide responses; WebKit allows all of them.
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame { onAnswer?() }
        guard navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse,
              response.statusCode >= 400 else {
            decisionHandler(.allow)
            return
        }
        // the cancelled load ends in WebKit's "frame load interrupted", which is not reported
        decisionHandler(.cancel)
        onFailure(webView, "HTTP \(response.statusCode) \(HTTPURLResponse.localizedString(forStatusCode: response.statusCode).capitalized)")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        inner?.webView?(webView, didFinish: navigation)
        onLoaded?()
        // the PC's page is up: a pairing link has done its work, and the PC is one worth keeping
        if let url = webView.url, let origin = PCStore.origin(of: url), origin == PCStore.current {
            PCStore.pendingStart = nil
            PCStore.remember(origin)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        inner?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        let nsError = error as NSError
        let cancelled = nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
        // WebKit's "frame load interrupted" (102) and "plug-in handled load" (204)
        let handedOff = nsError.domain == "WebKitErrorDomain" && (nsError.code == 102 || nsError.code == 204)
        if !cancelled && !handedOff { onFailure(webView, error.localizedDescription) }
    }
}
