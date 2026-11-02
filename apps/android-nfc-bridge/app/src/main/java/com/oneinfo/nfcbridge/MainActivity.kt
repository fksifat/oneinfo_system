package com.oneinfo.nfcbridge

import android.app.Activity
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
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class MainActivity : Activity(), NfcAdapter.ReaderCallback {
    private val apiUrl = "http://127.0.0.1:3001/api/v1/local-nfc"
    private val executor = Executors.newScheduledThreadPool(2)
    private val main = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var pairingCode: EditText
    private var poller: ScheduledFuture<*>? = null
    private var deviceToken: String? = null
    @Volatile private var activeTask: Task? = null
    private val nfcAdapter by lazy { NfcAdapter.getDefaultAdapter(this) }

    enum class TaskMode { WRITE, READ }
    data class Task(val sessionId: String, val mode: TaskMode, val expectedUrl: String? = null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        pairingCode = findViewById(R.id.pairingCode)
        deviceToken = getPreferences(MODE_PRIVATE).getString("deviceToken", null)
        findViewById<Button>(R.id.pairButton).setOnClickListener { pair() }
        if (nfcAdapter == null) setStatus("This device does not provide NFC hardware.")
        else if (deviceToken != null) {
            setStatus("Paired. Waiting for NFC work from the workstation…")
            startPolling()
        }
    }

    override fun onResume() {
        super.onResume()
        nfcAdapter?.enableReaderMode(this, this, NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B, null)
    }

    override fun onPause() {
        nfcAdapter?.disableReaderMode(this)
        super.onPause()
    }

    private fun pair() {
        val code = pairingCode.text.toString()
        if (code.length != 6) return setStatus("Enter the six-digit code displayed on the workstation.")
        setStatus("Pairing with local workstation…")
        executor.execute {
            try {
                val body = JSONObject()
                    .put("pairingCode", code)
                    .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}")
                    .put("runtimeVersion", "Android ${Build.VERSION.RELEASE}")
                val response = request("POST", "/devices/pair", body)
                deviceToken = response.getString("deviceToken")
                getPreferences(MODE_PRIVATE).edit().putString("deviceToken", deviceToken).apply()
                setStatus("Paired. Waiting for NFC work from the workstation…")
                startPolling()
            } catch (error: Exception) {
                setStatus("Pairing failed: ${error.message}")
            }
        }
    }

    private fun startPolling() {
        poller?.cancel(false)
        poller = executor.scheduleWithFixedDelay({
            if (activeTask != null) return@scheduleWithFixedDelay
            try {
                val response = request("GET", "/device/tasks/next")
                if (!response.isNull("sessionId")) {
                    activeTask = Task(response.getString("sessionId"), TaskMode.WRITE, response.getString("expectedUrl"))
                    setStatus("Ready to write. Hold the NFC card against the phone.")
                    return@scheduleWithFixedDelay
                }
                val readResponse = request("GET", "/device/read-tasks/next")
                if (!readResponse.isNull("sessionId")) {
                    activeTask = Task(readResponse.getString("sessionId"), TaskMode.READ)
                    setStatus("Ready to read. Hold the NFC card against the phone.")
                }
            } catch (error: Exception) {
                setStatus("Local USB connection unavailable: ${error.message}")
            }
        }, 0, 1200, TimeUnit.MILLISECONDS)
    }

    override fun onTagDiscovered(tag: Tag) {
        val task = activeTask ?: return setStatus("No NFC job is waiting on the workstation.")
        if (task.mode == TaskMode.READ) return readTag(task, tag)
        try {
            val expectedUrl = task.expectedUrl ?: throw IllegalStateException("WRITE_FAILED")
            val message = NdefMessage(arrayOf(NdefRecord.createUri(expectedUrl)))
            val ndef = Ndef.get(tag)
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
                formatable.connect()
                formatable.format(message)
                formatable.close()
                throw IllegalStateException("READBACK_FAILED")
            }
        } catch (error: Exception) {
            val code = error.message?.takeIf { it.matches(Regex("[A-Z_]+")) } ?: "WRITE_FAILED"
            submit(task, false, null, code)
        }
    }

    private fun submit(task: Task, succeeded: Boolean, readback: String?, errorCode: String?) {
        executor.execute {
            try {
                val metadata = JSONObject()
                    .put("adapter", "android-usb")
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
                request("POST", "/device/tasks/${task.sessionId}/result", body)
                setStatus(if (succeeded) "Card written and verified. Waiting for the next job…" else "NFC write failed: $errorCode")
            } catch (error: Exception) {
                setStatus("Could not report NFC result: ${error.message}")
            } finally {
                activeTask = null
            }
        }
    }

    private fun readTag(task: Task, tag: Tag) {
        executor.execute {
            val body = JSONObject()
                .put("uid", tag.id.joinToString("") { "%02X".format(it) })
                .put("techList", JSONArray(tag.techList.toList()))
                .put("ndefFormatted", false)
                .put("records", JSONArray())
                .put("deviceMetadata", JSONObject()
                    .put("adapter", "android-usb")
                    .put("manufacturer", Build.MANUFACTURER)
                    .put("model", Build.MODEL)
                    .put("androidVersion", Build.VERSION.RELEASE))
            var ndef: Ndef? = null
            try {
                ndef = Ndef.get(tag)
                if (ndef != null) {
                    ndef.connect()
                    val message = ndef.ndefMessage
                    val records = JSONArray()
                    message?.records?.forEach { record -> records.put(recordJson(record)) }
                    body.put("ndefFormatted", true)
                        .put("ndefType", ndef.type)
                        .put("writable", ndef.isWritable)
                        .put("maxSize", ndef.maxSize)
                        .put("messageSize", message?.toByteArray()?.size ?: 0)
                        .put("records", records)
                }
                request("POST", "/device/read-tasks/${task.sessionId}/result", body)
                setStatus("Tag read successfully. Full details are visible on the workstation.")
            } catch (error: Exception) {
                body.put("errorCode", "READ_FAILED")
                body.getJSONObject("deviceMetadata").put("message", error.message ?: "Unknown read error")
                try { request("POST", "/device/read-tasks/${task.sessionId}/result", body) } catch (_: Exception) {}
                setStatus("NFC read failed: ${error.message}")
            } finally {
                try { ndef?.close() } catch (_: Exception) {}
                activeTask = null
            }
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
                result.put("payloadText", payload.copyOfRange(languageLength + 1, payload.size).toString(Charsets.UTF_8))
            }
        }
        return result
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val connection = URL(apiUrl + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 3000
        connection.readTimeout = 5000
        connection.setRequestProperty("Content-Type", "application/json")
        deviceToken?.let { connection.setRequestProperty("x-oneinfo-device-token", it) }
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream.bufferedReader().use { it.readText() }
        if (connection.responseCode !in 200..299) throw IllegalStateException(JSONObject(text).optString("message", "HTTP ${connection.responseCode}"))
        return JSONObject(text)
    }

    private fun setStatus(value: String) {
        main.post { status.text = value }
    }
}
