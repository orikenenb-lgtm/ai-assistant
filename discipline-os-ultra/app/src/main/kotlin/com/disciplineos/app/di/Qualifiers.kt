package com.disciplineos.app.di

import javax.inject.Qualifier

/** Process-wide scope (SupervisorJob + Dispatchers.Default). Lives as long as the application process. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ApplicationScope

/** Dispatcher for blocking I/O (files, Keystore, WorkManager futures). Room suspend APIs need no wrapping. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class IoDispatcher
