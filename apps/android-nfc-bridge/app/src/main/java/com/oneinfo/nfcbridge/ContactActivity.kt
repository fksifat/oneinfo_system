package com.oneinfo.nfcbridge

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.os.Bundle
import android.provider.ContactsContract
import android.widget.Toast

class ContactActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val link = intent.data
        if (intent.action == Intent.ACTION_VIEW && link?.scheme == "oneinfo-contact" && link.host == "save" && link.encodedQuery.orEmpty().length <= 8192) {
            val name = link.getQueryParameter("name")?.trim().orEmpty()
            if (name.isNotEmpty()) {
                val editor = Intent(Intent.ACTION_INSERT).setType(ContactsContract.Contacts.CONTENT_TYPE)
                editor.putExtra(ContactsContract.Intents.Insert.NAME, name.take(120))
                val fields = mapOf(
                    "phone" to (ContactsContract.Intents.Insert.PHONE to 40),
                    "email" to (ContactsContract.Intents.Insert.EMAIL to 320),
                    "company" to (ContactsContract.Intents.Insert.COMPANY to 120),
                    "title" to (ContactsContract.Intents.Insert.JOB_TITLE to 160),
                )
                for ((field, target) in fields) {
                    val value = link.getQueryParameter(field)?.trim().orEmpty()
                    if (value.isNotEmpty()) editor.putExtra(target.first, value.take(target.second))
                }
                val website = link.getQueryParameter("website")?.trim().orEmpty()
                if (website.startsWith("https://") || website.startsWith("http://")) {
                    val row = ContentValues().apply {
                        put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE)
                        put(ContactsContract.CommonDataKinds.Website.URL, website.take(500))
                    }
                    editor.putParcelableArrayListExtra(ContactsContract.Intents.Insert.DATA, arrayListOf(row))
                }
                try {
                    startActivity(editor)
                } catch (_: ActivityNotFoundException) {
                    Toast.makeText(this, "No Contacts app can create a contact.", Toast.LENGTH_LONG).show()
                }
            }
        }
        finish()
    }
}
