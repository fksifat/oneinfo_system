package com.oneinfo.nfcbridge

/** NXP AN1304 and MF1S50YYX/V1 tables 7–8; only dedicated NDEF Classic 1K cards. */
object ClassicProtection {
    interface Card {
        val size: Int
        fun authenticate(sector: Int, key: ByteArray, keyB: Boolean): Boolean
        fun read(block: Int): ByteArray
        fun write(block: Int, bytes: ByteArray)
    }

    private fun hex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private val madKey = hex("A0A1A2A3A4A5")
    private val ndefKey = hex("D3F7D3F7D3F7")
    private val defaultKey = hex("FFFFFFFFFFFF")
    private val openAccess = hex("7F0788")
    private val madAccess = hex("787788")
    // Read-only data blocks, with trailer 011 so private Key B can restore writes.
    private val protectedAccess = hex("0F078F")
    private data class Sector(val number: Int, val trailer: ByteArray, val data: List<ByteArray>, val currentKey: ByteArray)

    fun apply(card: Card, keyHex: String, protect: Boolean): Int {
        require(keyHex.matches(Regex("[0-9a-fA-F]{12}"))) { "INVALID_PROTECTION_PASSWORD" }
        val secret = hex(keyHex)
        require(!secret.contentEquals(defaultKey) && !secret.contentEquals(madKey) && !secret.contentEquals(ndefKey) && secret.any { it != 0.toByte() }) { "DEFAULT_PROTECTION_PASSWORD" }
        check(card.size == 1024) { "ONLY_NDEF_CLASSIC_1K_SUPPORTED" }
        val order = (1..15).toList() + 0
        // Validate every sector and credential before the first trailer write.
        val sectors = order.map { sector ->
            val publicKey = if (sector == 0) madKey else ndefKey
            check(card.authenticate(sector, publicKey, false)) { "UNSUPPORTED_NDEF_SECTOR_KEY" }
            val trailer = card.read(sector * 4 + 3)
            check(trailer.size == 16) { "INVALID_SECTOR_TRAILER" }
            val access = trailer.copyOfRange(6, 9)
            check(if (sector == 0) access.contentEquals(madAccess) else access.contentEquals(protectedAccess) || access.contentEquals(openAccess)) { "UNSUPPORTED_SECTOR_ACCESS_BITS" }
            if (sector != 0) check((trailer[9].toInt() and 0xff) in listOf(0x40, 0x43)) { "UNSUPPORTED_NDEF_LAYOUT" }
            val data = (0..2).map { card.read(sector * 4 + it) }
            if (sector == 0) {
                check((trailer[9].toInt() and 0xc3) == 0xc1) { "UNSUPPORTED_MAD_LAYOUT" }
                val mad = data[1] + data[2]
                check((1..15).all { mad[it * 2] == 0x03.toByte() && mad[it * 2 + 1] == 0xe1.toByte() }) { "ONLY_DEDICATED_NDEF_CARDS_SUPPORTED" }
            }
            val currentKey = when {
                card.authenticate(sector, secret, true) -> secret
                (sector == 0 || (access.contentEquals(openAccess) && trailer[9] == 0x40.toByte())) && card.authenticate(sector, defaultKey, true) -> defaultKey
                else -> throw IllegalStateException("WRONG_PASSWORD_OR_ISSUER_KEY")
            }
            Sector(sector, trailer, data, currentKey)
        }
        var writing = false
        try {
            for (sector in sectors) {
                val publicKey = if (sector.number == 0) madKey else ndefKey
                val newKey = if (protect) secret else defaultKey
                val access = if (sector.number == 0) madAccess else if (protect) protectedAccess else openAccess
                val gpb = if (sector.number == 0) sector.trailer[9] else (if (protect) 0x43 else 0x40).toByte()
                val target = publicKey + access + byteArrayOf(gpb) + newKey
                check(card.authenticate(sector.number, sector.currentKey, true)) { "AUTHENTICATION_LOST" }
                writing = true
                card.write(sector.number * 4 + 3, target)
                check(card.authenticate(sector.number, newKey, true)) { "PROTECTION_KEY_READBACK_FAILED" }
                check(card.read(sector.number * 4 + 3).copyOfRange(6, 10).contentEquals(target.copyOfRange(6, 10))) { "PROTECTION_ACCESS_READBACK_FAILED" }
                check(card.authenticate(sector.number, publicKey, false)) { "PUBLIC_READ_FAILED" }
                check((0..2).all { card.read(sector.number * 4 + it).contentEquals(sector.data[it]) }) { "CARD_CONTENT_CHANGED" }
            }
            return sectors.size
        } catch (error: Exception) {
            if (writing) throw IllegalStateException("PROTECTION_INTERRUPTED_RETRY_SAME_PASSWORD", error)
            throw error
        } finally { secret.fill(0) }
    }
}
