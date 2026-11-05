package com.oneinfo.nfcbridge

import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

object LanConnection {
    fun validateUrl(value: String): String {
        val uri = URI(value)
        val parts = (uri.host ?: "").split('.').map { it.toIntOrNull() ?: -1 }
        val privateIp = parts.size == 4 && parts.all { it in 0..255 } &&
            (parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && parts[1] in 16..31))
        require(uri.scheme == "https" && privateIp && uri.port in 1..65535 && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.path in listOf("", "/")) { "Scan a valid Oneinfo LAN connection QR." }
        return value.trimEnd('/')
    }

    fun verifyFingerprint(encoded: ByteArray, fingerprint: String) {
        require(fingerprint.matches(Regex("[a-fA-F0-9]{64}"))) { "Invalid workstation identity." }
        val expected = fingerprint.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        if (!MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(encoded), expected)) throw CertificateException("Workstation identity does not match. Scan its Connection QR again.")
    }

    fun open(url: String, fingerprint: String?): HttpURLConnection {
        val endpoint = URL(url)
        require(endpoint.userInfo == null && endpoint.ref == null) { "Invalid workstation address." }
        val connection = endpoint.openConnection() as HttpURLConnection
        if (endpoint.protocol == "https") {
            validateUrl("https://${endpoint.host}:${endpoint.port}")
            require(!fingerprint.isNullOrBlank()) { "Workstation identity is missing. Scan its Connection QR." }
            val trust = object : X509TrustManager {
                override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
                override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) { throw CertificateException("Client certificates are not used") }
                override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                    val certificate = chain.firstOrNull() ?: throw CertificateException("Missing workstation certificate")
                    certificate.checkValidity()
                    verifyFingerprint(certificate.encoded, fingerprint)
                }
            }
            val context = SSLContext.getInstance("TLS"); context.init(null, arrayOf(trust), null)
            (connection as HttpsURLConnection).sslSocketFactory = context.socketFactory
            // The scanned certificate pin identifies this PC even after its DHCP address changes.
            connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { hostname, _ -> hostname == endpoint.host }
        } else require(endpoint.protocol == "http" && endpoint.host == "127.0.0.1" && endpoint.port == 3001) { "Use the secure LAN connection QR." }
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 3000; connection.readTimeout = 5000
        return connection
    }
}
