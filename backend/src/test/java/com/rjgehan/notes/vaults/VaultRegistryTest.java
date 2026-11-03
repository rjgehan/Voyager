package com.rjgehan.notes.vaults;

import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.NoUniqueBeanDefinitionException;
import org.springframework.context.ApplicationContext;
import org.springframework.mock.web.MockServletConfig;
import org.springframework.mock.web.MockServletContext;
import org.springframework.web.context.support.GenericWebApplicationContext;
import org.springframework.web.servlet.DispatcherServlet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** An extra vault's context whose dispatcher cannot be set up is closed, never left running (DESIGN §5.39). */
class VaultRegistryTest {

	private final MockServletContext servletContext = new MockServletContext();

	private final AtomicBoolean destroyed = new AtomicBoolean();

	/** A started context with a bean that records whether the context was closed. */
	private GenericWebApplicationContext context() {
		GenericWebApplicationContext context = new GenericWebApplicationContext(this.servletContext);
		context.registerBean("probe", DisposableBean.class, () -> () -> this.destroyed.set(true));
		return context;
	}

	@Test
	void aDispatcherThatCannotBeFoundClosesTheContext() {
		GenericWebApplicationContext context = context();
		context.registerBean("one", DispatcherServlet.class);
		context.registerBean("two", DispatcherServlet.class);
		context.refresh();

		assertThatThrownBy(() -> VaultRegistry.initDispatcher(context, new MockServletConfig(this.servletContext)))
			.isInstanceOf(NoUniqueBeanDefinitionException.class);
		assertThat(context.isActive()).isFalse();
		assertThat(this.destroyed).isTrue();
	}

	@Test
	void aDispatcherWhoseInitFailsWithAnErrorClosesTheContext() {
		GenericWebApplicationContext context = context();
		context.registerBean("dispatcherServlet", FailingDispatcher.class);
		context.refresh();

		assertThatThrownBy(() -> VaultRegistry.initDispatcher(context, new MockServletConfig(this.servletContext)))
			.isInstanceOf(StackOverflowError.class);
		assertThat(context.isActive()).isFalse();
		assertThat(this.destroyed).isTrue();
	}

	@Test
	void aDispatcherThatStartsIsReturnedWithItsContextRunning() throws Exception {
		GenericWebApplicationContext context = context();
		context.registerBean("dispatcherServlet", DispatcherServlet.class);
		context.refresh();
		try {
			DispatcherServlet servlet = VaultRegistry.initDispatcher(context, new MockServletConfig(this.servletContext));
			assertThat(servlet.getWebApplicationContext()).isSameAs(context);
			assertThat(context.isActive()).isTrue();
		}
		finally {
			context.close();
		}
	}

	static final class FailingDispatcher extends DispatcherServlet {

		@Override
		protected void onRefresh(ApplicationContext context) {
			throw new StackOverflowError("init failed");
		}

	}

}
