package com.oneinfo.nfcbridge

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.security.cert.CertificateException

class LanConnectionTest {
    @Test fun acceptsOnlyExplicitSecurePrivateWorkstationAddresses() {
        assertEquals("https://192.168.1.20:3443", LanConnection.validateUrl("https://192.168.1.20:3443/"))
        for (url in listOf("http://192.168.1.20:3443", "https://8.8.8.8:3443", "https://user:password@192.168.1.20:3443", "https://192.168.1.20:3443/?token=x", "https://192.168.1.20:3443/#data", "https://192.168.1.20:0", "https://192.168.1.999:3443")) {
            assertThrows(IllegalArgumentException::class.java) { LanConnection.validateUrl(url) }
        }
    }

    @Test fun rejectsAChangedCertificateAndDoesNotFollowRedirects() {
        val encoded = "test-certificate".toByteArray()
        val pin = MessageDigest.getInstance("SHA-256").digest(encoded).joinToString("") { "%02x".format(it) }
        LanConnection.verifyFingerprint(encoded, pin)
        assertThrows(CertificateException::class.java) { LanConnection.verifyFingerprint("changed".toByteArray(), pin) }
        assertThrows(IllegalArgumentException::class.java) { LanConnection.open("https://192.168.1.20:3443/health", null) }
        assertFalse(LanConnection.open("http://127.0.0.1:3001/health", null).instanceFollowRedirects)
        assertThrows(IllegalArgumentException::class.java) { LanConnection.open("http://192.168.1.20:3001/health", null) }
    }
}
