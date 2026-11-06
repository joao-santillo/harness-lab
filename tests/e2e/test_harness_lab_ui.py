from __future__ import annotations

from playwright.sync_api import Browser


def test_operator_workflow_in_real_browser(browser: Browser, live_server: str) -> None:
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.route(
        "**/*",
        lambda route: route.continue_()
        if route.request.url.startswith(live_server)
        else route.abort("blockedbyclient"),
    )

    primary_nav = page.get_by_role("navigation", name="Navegação principal")

    page.goto(live_server)
    primary_nav.get_by_role("link", name="Agentes", exact=True).click()
    page.get_by_label("ID", exact=True).fill("support-agent")
    page.get_by_label("Domínio").fill("retail")
    page.get_by_label("Nome").fill("Support Agent")
    page.get_by_role("button", name="Criar agente").click()
    page.get_by_role("cell", name="support-agent").wait_for()

    primary_nav.get_by_role("link", name="Cases", exact=True).click()
    csv_form = page.locator("form[action='/cases/csv']")
    csv_form.get_by_label("Domínio").fill("retail")
    csv_form.get_by_label("CSV").fill(
        "id,sessionId,similarityGroup,content\n"
        "case-1,session-1,access,Reset access\n"
        "case-2,session-2,billing,Second invoice"
    )
    csv_form.get_by_role("button", name="Importar lote").click()
    page.get_by_text("case-1", exact=True).wait_for()

    primary_nav.get_by_role("link", name="Rodadas", exact=True).click()
    page.get_by_label("ID", exact=True).fill("round-e2e")
    page.get_by_label("Domínio").fill("retail")
    page.get_by_label("Objetivo").fill("Improve support answers")
    page.get_by_role("button", name="Iniciar rodada").click()
    page.get_by_role("heading", name="round-e2e").wait_for()
    assert page.get_by_text("Aguardando o worker.").is_visible()

    context.close()