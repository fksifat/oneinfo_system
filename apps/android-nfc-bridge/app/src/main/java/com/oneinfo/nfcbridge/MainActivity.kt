package com.oneinfo.nfcbridge

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.view.View
import android.widget.RadioButton
import android.provider.Settings
import com.google.zxing.integration.android.IntentIntegrator
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.ScrollView
import android.view.inputmethod.InputMethodManager
import android.view.inputmethod.EditorInfo
import android.content.res.ColorStateList
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import java.net.Inet4Address
import android.net.ConnectivityManager
import android.net.Network
import android.util.Base64
import java.security.SecureRandom

class MainActivity : Activity(), NfcAdapter.ReaderCallback {
    @Volatile private var workstationUrl = "http://127.0.0.1:3001"
    @Volatile private var workstationFingerprint: String? = null
    @Volatile private var connectionGeneration = 0
    private val executor = Executors.newScheduledThreadPool(2)
    private val main = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var pairingCode: EditText
    private var poller: ScheduledFuture<*>? = null
    private var deviceToken: String? = null
    @Volatile private var activeTask: Task? = null
    @Volatile private var pendingResult: Pair<String, JSONObject>? = null
        set(value) {
            field = value
            if (::status.isInitialized) {
                val stored = value?.let { JSONObject().put("path", it.first).put("body", it.second).toString() }
                getPreferences(MODE_PRIVATE).edit().putString("pendingResult", stored).commit()
            }
        }
    private var pairingScan = false
    private var discovery: NsdManager.DiscoveryListener? = null
    private val resolvingWorkstation = AtomicBoolean(false)
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { main.post { restartDiscovery() } }
    }
    private val processingTag = AtomicBoolean(false)
    private val nfcAdapter by lazy { NfcAdapter.getDefaultAdapter(this) }
    @Volatile private var startingVerification = false
    @Volatile private var cameraScanning = false
    @Volatile private var scannedCard: JSONObject? = null
    @Volatile private var qrForQc = false
    @Volatile private var qcSessionId: String? = null
    private var lastTagResult: JSONObject? = null

    enum class TaskMode { WRITE, READ, UTILITY_WRITE, VERIFY_NFC, VERIFY_CAMERA }
    data class Task(val sessionId: String, val mode: TaskMode, val expiresAt: Instant, val expectedUrl: String? = null, val recordType: String = "URL")
    class ApiException(val statusCode: Int, message: String) : Exception(message)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        pairingCode = findViewById(R.id.pairingCode)
        deviceToken = getPreferences(MODE_PRIVATE).getString("deviceToken", null)
        workstationUrl = getPreferences(MODE_PRIVATE).getString("workstationUrl", workstationUrl)!!
        workstationFingerprint = getPreferences(MODE_PRIVATE).getString("workstationFingerprint", null)
        getPreferences(MODE_PRIVATE).getString("pendingResult", null)?.let {
            try { val saved = JSONObject(it); pendingResult = Pair(saved.getString("path"), saved.getJSONObject("body")) }
            catch (_: Exception) { setStatus("A saved result could not be restored. Read the tag before repeating a write.") }
        }
        findViewById<TextView>(R.id.workstationAddress).text = if (workstationFingerprint == null) "LAN not selected · USB development fallback" else workstationUrl
        findViewById<Button>(R.id.scanPairingQr).setOnClickListener {
            if (activeTask != null || pendingResult != null || startingVerification || cameraScanning) return@setOnClickListener
            pairingScan = true; cameraScanning = true
            IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan the PC Connection QR").setOrientationLocked(false).setBeepEnabled(false).initiateScan()
        }
        findViewById<Button>(R.id.usbFallbackToggle).setOnClickListener {
            val fallback = findViewById<View>(R.id.usbFallback); fallback.visibility = if (fallback.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }
        findViewById<Button>(R.id.pairButton).setOnClickListener { pair() }
        pairingCode.imeOptions = EditorInfo.IME_ACTION_DONE
        pairingCode.setOnEditorActionListener { _, actionId, _ -> if (actionId == EditorInfo.IME_ACTION_DONE) { pair(); true } else false }
        findViewById<Button>(R.id.verifyQr).setOnClickListener { startQrVerification(false) }
        findViewById<Button>(R.id.verifyQc).setOnClickListener { startQrVerification(true) }
        findViewById<Button>(R.id.loadNfc).setOnClickListener { loadToNfc() }
        findViewById<Button>(R.id.approveQc).setOnClickListener { approveQc() }
        findViewById<Button>(R.id.tabProduction).setOnClickListener { showPanel(R.id.productionPanel) }
        findViewById<Button>(R.id.tabTools).setOnClickListener { showPanel(R.id.toolsPanel) }
        findViewById<Button>(R.id.tabConnect).setOnClickListener { showPanel(R.id.connectPanel) }
        findViewById<Button>(R.id.readTag).setOnClickListener { startUtility("READ") }
        findViewById<Button>(R.id.writeTag).setOnClickListener {
            val value = findViewById<EditText>(R.id.tagValue).text.toString()
            if (value.isBlank()) setStatus("Enter the link or text to write first.")
            else AlertDialog.Builder(this).setTitle("Replace NFC content?")
                .setMessage("This replaces existing NDEF records on the tag you tap. Production and QC records will not change.\n\n${value.take(200)}")
                .setNegativeButton("Keep content", null).setPositiveButton("Replace and write") { _, _ -> startUtility("WRITE") }.show()
        }
        findViewById<Button>(R.id.eraseTag).setOnClickListener {
            AlertDialog.Builder(this).setTitle("Erase NFC tag?")
                .setMessage("This removes all NDEF links and text from the tag you tap. The tag stays reusable and its UID stays unchanged. This is not a secure wipe of chip memory. Production records will not change.")
                .setNegativeButton("Keep content", null).setPositiveButton("Erase tag") { _, _ -> startUtility("ERASE") }.show()
        }
        findViewById<Button>(R.id.cancelTask).setOnClickListener { cancelUtility() }
        findViewById<Button>(R.id.copyResult).setOnClickListener {
            lastTagResult?.let { (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("NFC tag result", it.toString(2))); setStatus("Tag result copied.") }
        }
        findViewById<Button>(R.id.shareResult).setOnClickListener {
            lastTagResult?.let { startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, it.toString(2)), "Share NFC result")) }
        }
        findViewById<Button>(R.id.nfcSettings).setOnClickListener { startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) }
        showPanel(if (deviceToken == null) R.id.connectPanel else R.id.productionPanel)
        updateActions()
        startDiscovery()
        (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).registerDefaultNetworkCallback(networkCallback)
        if (nfcAdapter == null) setStatus("This device does not provide NFC hardware.")
        else if (pendingResult != null && deviceToken != null) {
            setStatus("Sending the saved NFC result to the workstation…"); startPolling()
        } else if (getPreferences(MODE_PRIVATE).getString("pendingLanQr", null) != null) {
            connectFromQr(getPreferences(MODE_PRIVATE).getString("pendingLanQr", null)!!)
        } else if (deviceToken != null) {
            setStatus("Paired. Scan a printed QR to detect its batch and card.")
            startPolling()
        }
    }

    override fun onResume() {
        super.onResume()
        findViewById<TextView>(R.id.nfcStatus).text = if (nfcAdapter?.isEnabled == true) "NFC is on · Ready to scan" else "NFC is off · Enable it before scanning"
        nfcAdapter?.enableReaderMode(this, this, NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V, null)
    }

    override fun onPause() {
        nfcAdapter?.disableReaderMode(this)
        super.onPause()
    }

    override fun onDestroy() {
        try { (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(networkCallback) } catch (_: Exception) {}
        discovery?.let { try { (getSystemService(NSD_SERVICE) as NsdManager).stopServiceDiscovery(it) } catch (_: Exception) {} }
        poller?.cancel(false)
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun pair() {
        if (startingVerification) return
        val code = pairingCode.text.toString()
        if (code.length != 6) return setStatus("Enter the six-digit code displayed on the workstation.")
        startingVerification = true
        connectionGeneration++
        poller?.cancel(false)
        setStatus("Pairing with local workstation…")
        executor.execute {
            try {
                val body = JSONObject()
                    .put("pairingCode", code)
                    .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}")
                    .put("runtimeVersion", "Android ${Build.VERSION.RELEASE}")
                val response = requestAt("http://127.0.0.1:3001", null, "POST", "/devices/pair", body, null)
                workstationUrl = "http://127.0.0.1:3001"; workstationFingerprint = null
                deviceToken = response.getString("deviceToken")
                saveConnection()
                getPreferences(MODE_PRIVATE).edit().remove("pendingLanQr").remove("pendingLanCredential").commit()
                setStatus("Paired. Scan a printed QR to detect its batch and card.")
                main.post { pairingCode.setText(""); showPanel(R.id.productionPanel) }
            } catch (error: Exception) {
                setStatus("Pairing failed: ${error.message}")
            } finally {
                startingVerification = false
                if (deviceToken != null) startPolling()
                main.post { updateActions() }
            }
        }
    }

    private fun saveConnection() {
        getPreferences(MODE_PRIVATE).edit().putString("deviceToken", deviceToken).putString("workstationUrl", workstationUrl)
            .putString("workstationFingerprint", workstationFingerprint).commit()
        main.post { findViewById<TextView>(R.id.workstationAddress).text = if (workstationFingerprint == null) "USB development connection" else workstationUrl }
    }

    private fun probeWorkstation(base: String, fingerprint: String) {
        val connection = LanConnection.open(base + "/health", fingerprint)
        try {
            require(connection.responseCode == 200 && JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).optString("service") == "oneinfo-production-api") { "Oneinfo workstation is not available at this address." }
        } finally { connection.disconnect() }
    }

    private fun connectFromQr(value: String) {
        if (startingVerification || activeTask != null || pendingResult != null) return setStatus("Finish the current operation before changing connection.")
        startingVerification = true; connectionGeneration++; poller?.cancel(false)
        setStatus("Connecting securely to the workstation over Wi-Fi…")
        executor.execute {
            try {
                require(value.length < 8192) { "Connection QR is too large." }
                val qr = JSONObject(value)
                require(qr.optString("type") == "oneinfo-lan-pairing" && qr.optInt("version") == 1) { "Scan the QR in the PC's Connection tab." }
                val fingerprint = qr.getString("fingerprint").lowercase()
                require(fingerprint.matches(Regex("[a-f0-9]{64}"))) { "Invalid workstation identity." }
                val code = qr.getString("pairingCode"); val secret = qr.getString("pairingSecret")
                require(code.matches(Regex("[0-9]{6}")) && secret.length in 32..128) { "Invalid connection QR." }
                val urls = qr.getJSONArray("urls"); require(urls.length() in 1..8) { "The PC is not connected to a local network." }
                var selected: String? = null
                for (index in 0 until urls.length()) {
                    val candidate = LanConnection.validateUrl(urls.getString(index))
                    try { probeWorkstation(candidate, fingerprint); selected = candidate; break } catch (_: Exception) {}
                }
                val base = selected ?: throw Exception("Cannot reach this PC. Use the same Wi-Fi/LAN and allow Oneinfo through the PC firewall.")
                var token = if (fingerprint == workstationFingerprint) deviceToken else null
                if (token != null) {
                    try { requestAt(base, fingerprint, "GET", "/device/status", token = token) }
                    catch (error: ApiException) { if (error.statusCode == 401) token = null else throw error }
                }
                if (token == null) {
                    val preferences = getPreferences(MODE_PRIVATE)
                    val credential = if (preferences.getString("pendingLanQr", null) == value) preferences.getString("pendingLanCredential", null) else null
                    val proposed = credential ?: Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
                    preferences.edit().putString("pendingLanQr", value).putString("pendingLanCredential", proposed).commit()
                    val body = JSONObject().put("pairingCode", code).put("pairingSecret", secret)
                        .put("deviceCredential", proposed).put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}").put("runtimeVersion", "Android ${Build.VERSION.RELEASE}")
                    token = requestAt(base, fingerprint, "POST", "/devices/pair", body).getString("deviceToken")
                    require(token == proposed) { "Workstation did not confirm this phone's pairing credential." }
                }
                workstationUrl = base; workstationFingerprint = fingerprint; deviceToken = token
                saveConnection()
                getPreferences(MODE_PRIVATE).edit().remove("pendingLanQr").remove("pendingLanCredential").commit()
                setStatus("Wi-Fi connected. This PC is remembered; scan a printed card QR to begin.")
                main.post { showPanel(R.id.productionPanel); startDiscovery() }
            } catch (error: Exception) {
                setStatus("Connection failed: ${error.message}")
                if (error !is ApiException || error.statusCode >= 500) main.postDelayed({
                    if (!isDestroyed && !startingVerification && getPreferences(MODE_PRIVATE).getString("pendingLanQr", null) == value) connectFromQr(value)
                }, 5000)
                else if (error.statusCode in listOf(400, 401, 403, 404)) getPreferences(MODE_PRIVATE).edit().remove("pendingLanQr").remove("pendingLanCredential").commit()
            }
            finally { startingVerification = false; if (deviceToken != null) startPolling(); main.post { updateActions() } }
        }
    }

    private fun restartDiscovery() {
        discovery?.let { try { (getSystemService(NSD_SERVICE) as NsdManager).stopServiceDiscovery(it) } catch (_: Exception) {} }
        discovery = null
        main.postDelayed({ if (!isDestroyed && !isFinishing) startDiscovery() }, 700)
    }

    private fun startDiscovery() {
        if (workstationFingerprint == null || discovery != null || isDestroyed) return
        val manager = getSystemService(NSD_SERVICE) as NsdManager
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, code: Int) {
                if (discovery === this) discovery = null
                main.postDelayed({ if (!isDestroyed) startDiscovery() }, 5000)
            }
            override fun onStopDiscoveryFailed(type: String, code: Int) {}
            override fun onServiceLost(info: NsdServiceInfo) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                if (!info.serviceName.startsWith("Oneinfo-", ignoreCase = true) || !resolvingWorkstation.compareAndSet(false, true)) return
                try { manager.resolveService(info, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) { resolvingWorkstation.set(false) }
                    override fun onServiceResolved(service: NsdServiceInfo) {
                        val fingerprint = service.attributes["fingerprint"]?.toString(Charsets.UTF_8)
                        val addresses = if (Build.VERSION.SDK_INT >= 34) service.hostAddresses else listOfNotNull(service.host)
                        if (fingerprint == null || fingerprint != workstationFingerprint || isDestroyed) { resolvingWorkstation.set(false); return }
                        executor.execute {
                            try {
                                for (address in addresses.filterIsInstance<Inet4Address>()) {
                                    try {
                                        val base = LanConnection.validateUrl("https://${address.hostAddress}:${service.port}")
                                        probeWorkstation(base, fingerprint)
                                        if (base != workstationUrl) { workstationUrl = base; saveConnection(); setStatus("Workstation found on Wi-Fi. Connection address updated automatically.") }
                                        break
                                    } catch (_: Exception) {}
                                }
                            } catch (_: Exception) {} finally { resolvingWorkstation.set(false) }
                        }
                    }
                }) } catch (_: Exception) { resolvingWorkstation.set(false) }
            }
        }
        discovery = listener
        try { manager.discoverServices("_oneinfo-nfc._tcp.", NsdManager.PROTOCOL_DNS_SD, listener) }
        catch (_: Exception) { discovery = null }
    }

    private fun startPolling() {
        poller?.cancel(false)
        val generation = connectionGeneration
        poller = executor.scheduleWithFixedDelay({
            if (generation != connectionGeneration) return@scheduleWithFixedDelay
            try {
                request("GET", "/device/status")
                if (generation != connectionGeneration) return@scheduleWithFixedDelay
                pendingResult?.let { (path, body) ->
                    val response = request("POST", path, body)
                    pendingResult = null
                    activeTask = null
                    val state = response.optString("state")
                    if (path.contains("/verification-tasks/") && path.endsWith("/result")) {
                        qcSessionId = if (state == "MATCHED") path.substringAfter("/verification-tasks/").substringBefore("/") else null
                    }
                    if (path.contains("/tasks/") && path.endsWith("/result")) scannedCard = null
                    if (response.optString("qcStatus") == "PASSED") qcSessionId = null
                    setStatus(when {
                        path.contains("/read-tasks/") && state == "COMPLETED" && body.optJSONObject("deviceMetadata")?.optString("operation") == "ERASE" -> "Tag erased and verified empty. PC dashboard updated."
                        path.contains("/read-tasks/") && state == "COMPLETED" -> "NFC tool completed. Tag details are available here and on the PC."
                        path.contains("/read-tasks/") && state == "FAILED" -> "NFC tool failed. Check tag details and try again."
                        response.optString("qcStatus") == "PASSED" && response.optString("inventoryStatus") == "RESERVED" -> "QC APPROVED. Card remains reserved for its order. PC dashboard updated."
                        response.optString("qcStatus") == "PASSED" -> "QC APPROVED. Card released to saleable inventory. PC dashboard updated."
                        state == "MATCHED" -> "QR and NFC match. Tap Approve QC to finish. PC dashboard updated."
                        state == "MISMATCH" -> "QC blocked: QR and NFC do not match. PC dashboard updated."
                        state == "SUCCEEDED" -> "NFC link saved. Now scan QR for final QC, then tap NFC again."
                        state == "FAILED" -> "NFC write failed. Scan the printed QR again to retry."
                        else -> "NFC result delivered to the workstation."
                    })
                }
                val current = activeTask
                if (current != null && current.mode in listOf(TaskMode.READ, TaskMode.UTILITY_WRITE) && !processingTag.get()) {
                    val remote = request("GET", "/device/read-tasks/${current.sessionId}")
                    if (remote.optString("state") !in listOf("PENDING", "READING")) {
                        activeTask = null
                        setStatus("NFC tool stopped or expired. Ready for a new operation.")
                    }
                }
                if (activeTask?.expiresAt?.isBefore(Instant.now()) == true && !processingTag.get()) {
                    activeTask = null
                    setStatus("Request expired. Scan the printed QR again.")
                }
                if (activeTask != null || startingVerification || cameraScanning) return@scheduleWithFixedDelay
                val verification = request("GET", "/device/verification-tasks/next")
                if (generation != connectionGeneration) return@scheduleWithFixedDelay
                if (!verification.isNull("sessionId")) {
                    val mode = if (verification.getString("method") == "QR_CAMERA") TaskMode.VERIFY_CAMERA else TaskMode.VERIFY_NFC
                    val task = Task(verification.getString("sessionId"), mode, Instant.parse(verification.getString("expiresAt")), verification.getString("expectedUrl"))
                    activeTask = task
                    if (mode == TaskMode.VERIFY_CAMERA) main.post {
                        cameraScanning = true
                        setStatus("Scan the selected QR code with the camera.")
                        IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                            .setPrompt("Scan the selected Oneinfo QR code")
                            .setOrientationLocked(false).setBeepEnabled(false).initiateScan()
                    } else setStatus("Verification only. Lift the NFC tag away and tap it again.")
                    return@scheduleWithFixedDelay
                }
                val response = request("GET", "/device/tasks/next")
                if (generation != connectionGeneration) return@scheduleWithFixedDelay
                if (!response.isNull("sessionId")) {
                    activeTask = Task(response.getString("sessionId"), TaskMode.WRITE, Instant.parse(response.getString("expiresAt")), response.getString("expectedUrl"))
                    setStatus("Ready to write. Hold the NFC card against the phone.")
                    return@scheduleWithFixedDelay
                }
                val readResponse = request("GET", "/device/read-tasks/next")
                if (generation != connectionGeneration) return@scheduleWithFixedDelay
                if (!readResponse.isNull("sessionId")) {
                    acceptUtility(readResponse)
                }
            } catch (error: Exception) {
                if (generation != connectionGeneration) return@scheduleWithFixedDelay
                if (error is ApiException && error.statusCode in listOf(400, 401, 403, 404, 409)) {
                    pendingResult = null
                    activeTask = null
                    qcSessionId = null
                    scannedCard = null
                    if (error.statusCode == 401) {
                        deviceToken = null
                        getPreferences(MODE_PRIVATE).edit().remove("deviceToken").apply()
                        poller?.cancel(false)
                    }
                }
                setStatus(if (error is ApiException && error.statusCode == 401) "Device access was removed. Scan a new Connection QR from the PC to pair again."
                    else if (error is ApiException) "Operation could not complete: ${error.message}" else "Workstation connection unavailable: ${error.message}")
                main.post { findViewById<TextView>(R.id.connectionStatus).text = if (deviceToken == null) "Not paired · Open Connect" else if (error is ApiException) "Paired · Workstation connected" else if (workstationFingerprint != null) "Reconnecting · Keep phone and PC on the same network" else "Workstation unavailable · Check USB development tunnel" }
                if (deviceToken == null) main.post { showPanel(R.id.connectPanel) }
            }
        }, 0, 1200, TimeUnit.MILLISECONDS)
    }

    private fun showPanel(panelId: Int) {
        currentFocus?.let { focus -> (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(focus.windowToken, 0); focus.clearFocus() }
        listOf(R.id.productionPanel, R.id.toolsPanel, R.id.connectPanel).forEach { findViewById<View>(it).visibility = if (it == panelId) View.VISIBLE else View.GONE }
        listOf(R.id.tabProduction to R.id.productionPanel, R.id.tabTools to R.id.toolsPanel, R.id.tabConnect to R.id.connectPanel).forEach { (buttonId, target) ->
            findViewById<Button>(buttonId).apply {
                isSelected = target == panelId
                backgroundTintList = ColorStateList.valueOf(if (isSelected) Color.rgb(17,123,120) else Color.rgb(229,239,240))
                setTextColor(if (isSelected) Color.WHITE else Color.rgb(18,51,68))
            }
        }
        findViewById<ScrollView>(R.id.contentScroll).post { findViewById<ScrollView>(R.id.contentScroll).scrollTo(0, 0) }
    }

    private fun startUtility(operation: String) {
        if (deviceToken == null) return setStatus("Pair the phone with your workstation first.")
        if (activeTask != null || pendingResult != null || startingVerification || cameraScanning) return setStatus("Finish the current operation first.")
        if (nfcAdapter?.isEnabled != true) return setStatus("Enable NFC in Connect → Open NFC settings.")
        val input = JSONObject().put("operation", operation)
        if (operation == "ERASE") input.put("overwriteConfirmed", true)
        if (operation == "WRITE") input.put("recordType", if (findViewById<RadioButton>(R.id.urlType).isChecked) "URL" else "TEXT")
            .put("value", findViewById<EditText>(R.id.tagValue).text.toString()).put("overwriteConfirmed", true)
        startingVerification = true
        setStatus("Preparing NFC tool…")
        executor.execute {
            try {
                val response = request("POST", "/device/utility-sessions", input)
                response.put("sessionId", response.getString("id"))
                acceptUtility(response)
            } catch (error: Exception) { setStatus(if (error is ApiException && error.statusCode == 400) "Use a valid HTTP(S) website link or nonempty plain text (up to 2048 characters)." else "Could not start NFC tool: ${error.message}") }
            finally { startingVerification = false; main.post { updateActions() } }
        }
    }

    private fun acceptUtility(response: JSONObject) {
        val utility = response.optJSONObject("utility") ?: JSONObject().put("operation", "READ")
        val erase = utility.optString("operation") == "ERASE"
        val write = utility.optString("operation") in listOf("WRITE", "ERASE")
        activeTask = Task(response.getString("sessionId"), if (write) TaskMode.UTILITY_WRITE else TaskMode.READ,
            Instant.parse(response.getString("expiresAt")), if (write) utility.optString("value", "") else null, if (erase) "EMPTY" else utility.optString("recordType", "URL"))
        main.post { showPanel(R.id.toolsPanel) }
        setStatus(if (erase) "Ready to erase NDEF content. Tap ONLY the tag you want to empty." else if (write) "Ready to replace NDEF content with ${utility.getString("recordType")}: ${utility.getString("value").take(120)}. Tap the target tag." else "Ready to read. Tap an NFC tag to inspect it.")
    }

    private fun cancelUtility() {
        val task = activeTask ?: return
        if (task.mode !in listOf(TaskMode.READ, TaskMode.UTILITY_WRITE) || processingTag.get() || pendingResult != null) return
        startingVerification = true
        setStatus("Stopping waiting task…")
        executor.execute {
            try { request("POST", "/device/read-tasks/${task.sessionId}/cancel", JSONObject()); activeTask = null; setStatus("Waiting task stopped.") }
            catch (error: Exception) { setStatus("Could not stop task: ${error.message}") }
            finally { startingVerification = false; main.post { updateActions() } }
        }
    }

    private fun startQrVerification(forQc: Boolean) {
        if (deviceToken == null) return setStatus("Pair the phone with the workstation first.")
        if (activeTask != null || pendingResult != null || startingVerification || cameraScanning) return setStatus("Complete the current operation first.")
        activeTask = Task("", TaskMode.VERIFY_CAMERA, Instant.now().plusSeconds(120))
        qrForQc = forQc
        scannedCard = null
        qcSessionId = null
        cameraScanning = true
        findViewById<TextView>(R.id.verificationUrl).text = if (forQc) "Final QC: scan the printed QR again, then tap NFC to compare both links." else "Scan the printed QR to detect its batch and card. Then choose Load to NFC."
        IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            .setPrompt(if (forQc) "Final QC: scan QR, then tap NFC" else "Scan printed QR to identify card").setOrientationLocked(false).setBeepEnabled(false).initiateScan()
    }

    private fun loadToNfc() {
        val card = scannedCard ?: return setStatus("Scan the printed QR first.")
        if (activeTask != null || pendingResult != null || startingVerification) return
        startingVerification = true
        setStatus("Preparing to load this QR link to NFC…")
        executor.execute {
            try {
                val response = request("POST", "/device/load-to-nfc", JSONObject().put("scanId", card.getString("scanId")))
                if (response.getString("state") != "WRITING") throw IllegalStateException("Scan the QR again for a new write attempt.")
                activeTask = Task(response.getString("sessionId"), TaskMode.WRITE, Instant.parse(response.getString("expiresAt")), response.getString("expectedUrl"))
                setStatus("Load to NFC ready. Hold THIS card against the phone to write its QR link.")
            } catch (error: Exception) { setStatus("Could not start NFC write: ${error.message}") }
            finally { startingVerification = false; main.post { updateActions() } }
        }
    }

    private fun approveQc() {
        val sessionId = qcSessionId ?: return
        if (activeTask != null || pendingResult != null || startingVerification) return
        pendingResult = Pair("/device/verification-tasks/$sessionId/approve", JSONObject())
        setStatus("Saving QC approval…")
    }

    override fun onTagDiscovered(tag: Tag) {
        val task = activeTask ?: return setStatus("No NFC job is waiting on the workstation.")
        if (task.expiresAt.isBefore(Instant.now())) {
            activeTask = null
            return setStatus("Request expired. Start a new operation on the workstation.")
        }
        if (pendingResult != null || !processingTag.compareAndSet(false, true)) return
        if (task.mode == TaskMode.VERIFY_CAMERA) {
            processingTag.set(false)
            return
        }
        if (task.mode == TaskMode.VERIFY_NFC) return verifyNfc(task, tag)
        if (task.mode == TaskMode.READ) return readTag(task, tag)
        if (task.mode == TaskMode.UTILITY_WRITE) return writeUtility(task, tag)
        var connection: Ndef? = null
        try {
            val expectedUrl = task.expectedUrl ?: throw IllegalStateException("WRITE_FAILED")
            val message = NdefMessage(arrayOf(NdefRecord.createUri(expectedUrl)))
            val ndef = Ndef.get(tag)
            connection = ndef
            if (ndef != null) {
                ndef.connect()
                if (!ndef.isWritable) throw IllegalStateException("TAG_READ_ONLY_OR_LOCKED")
                if (ndef.maxSize < message.toByteArray().size) throw IllegalStateException("WRITE_FAILED")
                ndef.writeNdefMessage(message)
                ndef.close()
                ndef.connect()
                val readback = ndef.ndefMessage?.records?.firstOrNull()?.toUri()?.toString()
                ndef.close()
                if (readback != expectedUrl) throw IllegalStateException("READBACK_MISMATCH")
                submit(task, true, readback, null)
            } else {
                val formatable = NdefFormatable.get(tag) ?: throw IllegalStateException("NOT_NDEF_FORMATTED")
                formatable.use {
                    it.connect()
                    it.format(message)
                }
                setStatus("Tag formatted. Lift the card and tap again to verify it.")
            }
        } catch (error: Exception) {
            val code = error.message?.takeIf { it.matches(Regex("[A-Z_]+")) } ?: "WRITE_FAILED"
            submit(task, false, null, code)
        } finally {
            try { connection?.close() } catch (_: Exception) {}
            processingTag.set(false)
        }
    }

    private fun submit(task: Task, succeeded: Boolean, readback: String?, errorCode: String?) {
            try {
                val metadata = JSONObject()
                    .put("adapter", if (workstationFingerprint == null) "android-usb" else "android-lan")
                    .put("manufacturer", Build.MANUFACTURER)
                    .put("model", Build.MODEL)
                    .put("androidVersion", Build.VERSION.RELEASE)
                    .put("protocol", "NDEF_URI")
                val body = JSONObject()
                    .put("result", if (succeeded) "SUCCEEDED" else "FAILED")
                    .put("expectedUrl", task.expectedUrl)
                    .put("deviceMetadata", metadata)
                if (readback != null) body.put("readbackUrl", readback)
                if (errorCode != null) body.put("errorCode", errorCode)
                pendingResult = Pair("/device/tasks/${task.sessionId}/result", body)
                setStatus(if (succeeded) "Card written and verified. Sending result…" else "NFC write failed: $errorCode")
            } catch (error: Exception) {
                setStatus("Could not report NFC result: ${error.message}")
            }
    }

    private fun tagBase(tag: Tag) = JSONObject()
        .put("uid", tag.id.joinToString("") { "%02X".format(it) })
        .put("techList", JSONArray(tag.techList.toList())).put("ndefFormatted", false).put("records", JSONArray())
        .put("deviceMetadata", JSONObject().put("adapter", "android-adb").put("model", Build.MODEL))

    private fun inspectTag(tag: Tag): JSONObject {
        val body = tagBase(tag)
        val ndef = Ndef.get(tag) ?: return body
        ndef.use {
            it.connect()
            val message = it.ndefMessage
            val records = JSONArray()
            message?.records?.forEach { record -> records.put(recordJson(record)) }
            body.put("ndefFormatted", true).put("ndefType", it.type).put("writable", it.isWritable)
                .put("maxSize", it.maxSize).put("messageSize", message?.toByteArray()?.size ?: 0).put("records", records)
        }
        return body
    }

    private fun finishUtility(task: Task, body: JSONObject) {
        if (task.recordType == "EMPTY") body.getJSONObject("deviceMetadata").put("operation", "ERASE")
        pendingResult = Pair("/device/read-tasks/${task.sessionId}/result", body)
        main.post {
            lastTagResult = body
            val records = body.optJSONArray("records") ?: JSONArray()
            val content = (0 until records.length()).joinToString("\n\n") { index ->
                val record = records.getJSONObject(index)
                "Record ${index + 1}: " + if (record.optInt("tnf") == 0) "Empty NDEF record" else record.optString("uri", record.optString("payloadText", "Binary record; share JSON for raw data"))
            }
            findViewById<TextView>(R.id.tagDetails).text = "UID: ${body.optString("uid")}\nType: ${body.optString("ndefType", "Not NDEF formatted")}\nWritable: ${body.optString("writable", "Unknown")}\nSize: ${body.optString("messageSize", "0")} / ${body.optString("maxSize", "unknown")} bytes\nTechnologies: ${body.optJSONArray("techList")}\n\n$content" + if (body.has("errorCode")) "\n\nError: ${body.optString("errorCode")}" else ""
            updateActions()
        }
        setStatus(if (body.has("errorCode")) "NFC tool failed: ${body.optString("errorCode")}. Sending result…" else "Tag ${if (task.recordType == "EMPTY") "erased and verified empty" else if (task.mode == TaskMode.UTILITY_WRITE) "written and read back" else "read"}. Sending details to the PC…")
    }

    private fun readTag(task: Task, tag: Tag) {
        executor.execute {
            try { finishUtility(task, inspectTag(tag)) }
            catch (error: Exception) { finishUtility(task, tagBase(tag).put("errorCode", "READ_FAILED")) }
            finally { processingTag.set(false); main.post { updateActions() } }
        }
    }

    private fun writeUtility(task: Task, tag: Tag) {
        executor.execute {
            try {
                if (request("GET", "/device/read-tasks/${task.sessionId}").getString("state") != "READING") throw IllegalStateException("OPERATION_CANCELLED")
                val value = task.expectedUrl ?: throw IllegalStateException("MISSING_CONTENT")
                val record = when (task.recordType) {
                    "EMPTY" -> NdefRecord(NdefRecord.TNF_EMPTY, byteArrayOf(), byteArrayOf(), byteArrayOf())
                    "TEXT" -> NdefRecord.createTextRecord("en", value)
                    else -> NdefRecord.createUri(value)
                }
                val message = NdefMessage(arrayOf(record))
                val ndef = Ndef.get(tag)
                if (ndef == null) {
                    val formatable = NdefFormatable.get(tag) ?: throw IllegalStateException("NOT_NDEF_FORMATTABLE")
                    formatable.use { it.connect(); it.format(message) }
                    setStatus("Tag formatted. Lift it away and tap again to confirm readback.")
                    return@execute
                }
                ndef.use {
                    it.connect()
                    if (!it.isWritable) throw IllegalStateException("TAG_READ_ONLY_OR_LOCKED")
                    if (it.maxSize < message.toByteArray().size) throw IllegalStateException("TAG_CAPACITY_TOO_SMALL")
                    if (it.ndefMessage?.toByteArray()?.contentEquals(message.toByteArray()) != true) it.writeNdefMessage(message)
                }
                val body = inspectTag(tag)
                val saved = body.getJSONArray("records")
                val readback = if (saved.length() == 1) saved.getJSONObject(0).optString(if (task.recordType == "TEXT") "payloadText" else "uri") else ""
                if (task.recordType == "EMPTY") {
                    val empty = saved.length() == 1 && saved.getJSONObject(0).getInt("tnf") == 0 && saved.getJSONObject(0).getString("payloadHex").isEmpty()
                    if (!empty) body.put("errorCode", "ERASE_READBACK_MISMATCH")
                } else if (readback != value) body.put("errorCode", "READBACK_MISMATCH")
                finishUtility(task, body)
            } catch (error: Exception) {
                val code = error.message?.takeIf { it.matches(Regex("[A-Z_]+")) } ?: "WRITE_FAILED"
                finishUtility(task, tagBase(tag).put("errorCode", code))
            } finally { processingTag.set(false); main.post { updateActions() } }
        }
    }

    private fun recordJson(record: NdefRecord): JSONObject {
        val payload = record.payload ?: byteArrayOf()
        val type = record.type?.toString(Charsets.UTF_8) ?: ""
        val result = JSONObject()
            .put("tnf", record.tnf.toInt())
            .put("type", type)
            .put("idHex", (record.id ?: byteArrayOf()).joinToString("") { "%02X".format(it) })
            .put("payloadHex", payload.joinToString("") { "%02X".format(it) })
        val uri = try { record.toUri()?.toString() } catch (_: Exception) { null }
        if (!uri.isNullOrBlank()) result.put("uri", uri)
        if (record.tnf == NdefRecord.TNF_WELL_KNOWN && record.type.contentEquals(NdefRecord.RTD_TEXT) && payload.isNotEmpty()) {
            val languageLength = payload[0].toInt() and 0x3F
            if (payload.size > languageLength + 1) {
                val encoding = if (payload[0].toInt() and 0x80 != 0) Charsets.UTF_16 else Charsets.UTF_8
                result.put("payloadText", payload.copyOfRange(languageLength + 1, payload.size).toString(encoding))
            }
        }
        return result
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val scan = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (scan != null) {
            cameraScanning = false
            if (pairingScan) {
                pairingScan = false
                if (scan.contents == null) setStatus("Workstation connection scan cancelled.") else connectFromQr(scan.contents)
                return
            }
            val task = activeTask
            if (task?.mode == TaskMode.VERIFY_CAMERA) {
                if (task.sessionId.isEmpty()) {
                    if (scan.contents == null) { activeTask = null; setStatus("QR scan cancelled. Start a new scan when ready.") }
                    else resolveScannedQr(scan.contents)
                } else verificationResult(task, scan.contents ?: "", null, if (scan.contents == null) "CAMERA_SCAN_CANCELLED" else null)
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun resolveScannedQr(value: String) {
        startingVerification = true
        findViewById<TextView>(R.id.verificationUrl).text = "QR link: $value"
        setStatus("QR captured. Preparing NFC comparison…")
        executor.execute {
            try {
                val response = request("POST", if (qrForQc) "/device/verification-from-qr" else "/device/resolve-qr", JSONObject()
                    .put("scanId", java.util.UUID.randomUUID().toString()).put("scannedValue", value))
                if (qrForQc) {
                    activeTask = Task(response.getString("sessionId"), TaskMode.VERIFY_NFC,
                        Instant.parse(response.getString("expiresAt")), value)
                    setStatus("Final QC: QR captured. Lift the card away, then tap its NFC tag to compare links.")
                } else {
                    activeTask = null
                    scannedCard = response
                    main.post { findViewById<TextView>(R.id.verificationUrl).text = "Batch: ${response.getString("batchCode")}\nCard: ${response.getString("publicSlug")}\nQR link: $value\nNFC: ${response.getString("nfcStatus")} · QC: ${response.getString("qcStatus")}" }
                    setStatus(if (response.getString("nfcStatus") == "WRITTEN") "Card detected. NFC is already written; use Scan QR for final QC." else "Printed QR recognized. Tap Load to NFC to write the same link to this card.")
                }
            } catch (error: Exception) {
                activeTask = null
                setStatus("Could not verify this QR: ${error.message}")
            } finally { startingVerification = false; main.post { updateActions() } }
        }
    }

    private fun verifyNfc(task: Task, tag: Tag) {
        executor.execute {
            var ndef: Ndef? = null
            try {
                ndef = Ndef.get(tag) ?: throw IllegalStateException("NOT_NDEF_FORMATTED")
                ndef.connect()
                val uri = ndef.ndefMessage?.records?.mapNotNull { it.toUri()?.toString() }?.firstOrNull() ?: ""
                verificationResult(task, uri, tag.id.joinToString("") { "%02X".format(it) }, null)
            } catch (error: Exception) {
                verificationResult(task, "", null, "NFC_READ_FAILED")
            } finally {
                try { ndef?.close() } catch (_: Exception) {}
                processingTag.set(false)
            }
        }
    }

    private fun verificationResult(task: Task, value: String, uid: String?, error: String?) {
        val body = JSONObject().put("scannedValue", value)
            .put("deviceMetadata", JSONObject().put("adapter", if (workstationFingerprint == null) "android-usb" else "android-lan").put("model", Build.MODEL))
        if (uid != null) body.put("uid", uid)
        if (error != null) body.put("errorCode", error)
        pendingResult = Pair("/device/verification-tasks/${task.sessionId}/result", body)
        setStatus(if (error == null && value == task.expectedUrl) "Scan matched. Sending result…" else "Scan did not match the selected card. Sending result…")
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        return requestAt(workstationUrl, workstationFingerprint, method, path, body, deviceToken)
    }

    private fun requestAt(base: String, fingerprint: String?, method: String, path: String, body: JSONObject? = null, token: String? = null): JSONObject {
        val connection = LanConnection.open(base + "/api/v1/local-nfc" + path, fingerprint)
        connection.requestMethod = method
        connection.connectTimeout = 3000
        connection.readTimeout = 5000
        connection.setRequestProperty("Content-Type", "application/json")
        token?.let { connection.setRequestProperty("x-oneinfo-device-token", it) }
        try {
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            if (code !in 200..299) throw ApiException(code, JSONObject(text).optString("message", "HTTP $code"))
            main.post { findViewById<TextView>(R.id.connectionStatus).text = if (deviceToken != null) "Paired · Workstation connected" else "Not paired · Open Connect" }
            return JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun setStatus(value: String) {
        main.post { status.text = value; updateActions() }
    }

    private fun updateActions() {
        val idle = deviceToken != null && activeTask == null && pendingResult == null && !startingVerification && !cameraScanning
        findViewById<Button>(R.id.verifyQr).isEnabled = idle
        findViewById<Button>(R.id.verifyQc).isEnabled = idle
        findViewById<Button>(R.id.loadNfc).isEnabled = idle && scannedCard != null && scannedCard?.optString("nfcStatus") != "WRITTEN" && scannedCard?.optString("qcStatus") != "PASSED"
        findViewById<Button>(R.id.approveQc).isEnabled = idle && qcSessionId != null
        findViewById<Button>(R.id.readTag).isEnabled = idle
        findViewById<Button>(R.id.writeTag).isEnabled = idle
        findViewById<Button>(R.id.eraseTag).isEnabled = idle
        findViewById<Button>(R.id.pairButton).isEnabled = activeTask == null && pendingResult == null && !startingVerification
        findViewById<Button>(R.id.scanPairingQr).isEnabled = activeTask == null && pendingResult == null && !startingVerification && !cameraScanning
        findViewById<Button>(R.id.cancelTask).visibility = if (activeTask?.mode in listOf(TaskMode.READ, TaskMode.UTILITY_WRITE)) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.cancelTask).isEnabled = !processingTag.get() && pendingResult == null && !startingVerification
        findViewById<Button>(R.id.copyResult).isEnabled = lastTagResult != null
        findViewById<Button>(R.id.shareResult).isEnabled = lastTagResult != null
        listOf(R.id.verifyQr, R.id.verifyQc, R.id.loadNfc, R.id.approveQc, R.id.readTag, R.id.writeTag, R.id.eraseTag, R.id.pairButton, R.id.copyResult, R.id.shareResult).forEach {
            val button = findViewById<Button>(it)
            button.alpha = if (button.isEnabled) 1f else 0.4f
        }
    }
}
