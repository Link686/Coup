using Microsoft.AspNetCore.SignalR;

namespace Coup.hub
{
    public class JogoHub : Hub
    {
        private static List<Carta> CartasPossiveis = new List<Carta>()
        {
            new Carta(){ Id = 1, Nome = "Duque" },
            new Carta(){ Id = 2, Nome = "Capitão" },
            new Carta(){ Id = 3, Nome = "Assassino" },
            new Carta(){ Id = 4, Nome = "Condessa" },
            new Carta(){ Id = 5, Nome = "Embaixador" },
            new Carta(){ Id = 6, Nome = "Inquisidor" },
        };

        bool JogadoComessou = false;
        private static List<Jogador> Jogadores = new List<Jogador>();
        private static List<Carta> Barralho = new List<Carta>();
        private static List<AcaoTurno> AcaoPossiveis = new List<AcaoTurno>()
        {
            new AcaoTurno(){ Id = 1, acao = AcaoTurnoEnum.Renda, Nome = "Renda", Descrição = "Pegue 1 moeda do tesouro Central. Não pode ser bloqueado ou contestato"},
            new AcaoTurno(){ Id = 2, acao = AcaoTurnoEnum.AjudaExterna, Nome = "Ajuda Externa", Descrição = "Pegue 2 moeda do tesouro Central. Pode ser bloqueado pelo Duque"},
            new AcaoTurno(){ Id = 3, acao = AcaoTurnoEnum.GolpeDeEstado, Nome = "Golpe De Estado", Descrição = "Pegue 7 moeda e escolha um oponente que perderá uma de suas influências. Não pode ser bloqueado ou contestado"},
            
            new AcaoTurno(){ Id = 4, acao = AcaoTurnoEnum.Duque, Nome = "Duque", Descrição = "Pegue 3 moeda do tesouro Central. Não pode ser bloqueado ou contestado"},
            new AcaoTurno(){ Id = 5, acao = AcaoTurnoEnum.Caitao, Nome = "Capitão", Descrição = "Pegue 2 moeda de um oponente. Pode ser bloquedo pelo capitao ou Embaixador/Inquisitor"},
            new AcaoTurno(){ Id = 6, acao = AcaoTurnoEnum.Asassino, Nome = "Assassino", Descrição = "Pague 3 moedas. Escolha um oponente que perderá uma influencia"},
            new AcaoTurno(){ Id = 7, acao = AcaoTurnoEnum.Condesa, Nome = "Condessa", Descrição = "Bloqueia o Assassino. Não pode ser bloqueada"},
            new AcaoTurno(){ Id = 8, acao = AcaoTurnoEnum.Embaixador, Nome = "Embaixador", Descrição = "Pegue 2 cartas e em seguida devolva 2 cartas para o Baralho da Corte. Não pode ser bloqueado"},
            new AcaoTurno(){ Id = 9, acao = AcaoTurnoEnum.Inquisitor, Nome = "Inquisitor", Descrição = "Pegue 1 carta e em seguida devolva 1 carta para o baralho da corte. Não pode ser bloqueado. Olhe 1 carta de um oponente. Pode obrigá-lo a trocá-la. Não pode ser bloqueado."},
        };


        public override Task OnConnectedAsync()
        {
            //string IdJogador = Context.ConnectionId;

            return base.OnConnectedAsync();
        }

        public async Task ConctarNovoJogador(string NomeDoJogador)
        {
            if (!JogadoComessou)
            {
                await Clients.Caller.SendAsync("NotificarJogoJaEstaEmProgresso");
                return;
            }

            var JogadorAtual = Jogadores.FirstOrDefault(x => x.NomeDoJogador == NomeDoJogador);
            if (JogadorAtual != null)
            {
                await Clients.Caller.SendAsync("NotificarNomeRepetido");
                return;
            }

            string IdJogador = Context.ConnectionId;
            Jogadores.Add(new Jogador(IdJogador, NomeDoJogador, Jogadores.Count + 1));
            await Clients.All.SendAsync("NotificarJogadorCriado");
        }
        public async Task ComecarJogo()
        {
            if (Jogadores.Count < 3)
            {
                await Clients.Caller.SendAsync("NotificarJogadoresInsuficiente");
                return;
            }

            JogadoComessou = true;

            Barralho = GerarBaralho(Jogadores.Count);

            foreach (var item in Jogadores)
            {
                var cartasJogador = Barralho.GetRange(0, 2);
                Barralho.RemoveRange(0, 2);

                item.Cartas.AddRange(cartasJogador);
            }


            await Clients.All.SendAsync("NotificarInicioDoJogo",
                Jogadores.Select(x => new
                {
                    IdJogador = x.IdJogador,
                    NomeDoJogador = x.NomeDoJogador,
                    Ordem = x.Ordem,
                    Moedas = x.Moedas,
                })
            );
        }


        public async Task DeclararMovimento(string IdJogado, AcaoTurno AcaoDeclarada)
        {
            var JogadorAtual = Jogadores.FirstOrDefault(x => x.IdJogador == IdJogado);

            if()
            await Clients.Others.SendAsync("MostarTelaContestar",
                new
                {
                    IdJogado = JogadorAtual.IdJogador,
                    Moedas = JogadorAtual.Moedas,
                }
            );
        }


        private List<Carta> GerarBaralho(int NrJogadores)
        {
            List<Carta> Baralho = new List<Carta>();

            int QtCarta = (NrJogadores <= 6) ? 3 :
                            (NrJogadores >= 7 && NrJogadores <= 8) ? 4 :
                            (NrJogadores >= 9 && NrJogadores <= 10) ? 5 : 6;

            foreach (var item in CartasPossiveis)
                for (int j = 1; j <= QtCarta; j++)
                    Baralho.Add(item);

            var random = new Random();
            var baralhoEmbaralhado = Baralho.OrderBy(x => random.Next()).ToList();

            return baralhoEmbaralhado;
        }
    }
    public class Jogador
    {
        public string IdJogador { get; set; } = "";
        public string NomeDoJogador { get; set; } = "";
        public List<Carta> Cartas { get; set; } = new List<Carta>();
        public int Ordem { get; set; } = 0;
        public int Moedas { get; set; } = 2;

        public Jogador(string IdJogador, string NomeDoJogador, int Ordem)
        {
            this.IdJogador = IdJogador;
            this.NomeDoJogador = NomeDoJogador;
            this.Ordem = Ordem;
        }

        public void RealizarAcao(int AcaoDeclarada, Jogador Alvo, int CartaAlvo, List<Carta> CartasNovas)
        {
            if()
            if (AcaoDeclarada == AcaoTurno.Renda)
            {
                Moedas++;
            }
            else if (AcaoDeclarada == AcaoTurno.AjudaExterna)
            {
                Moedas += 2;
            }
            else if (AcaoDeclarada == AcaoTurno.GolpeDeEstado)
            {
                if (Moedas < 7)
                    throw new Exception("Quantidade de moedas insuficiente");


                Moedas -= 7;
                Alvo.Cartas.Remove(Alvo.Cartas[CartaAlvo]);

                //declarar fim do jogo para o jogador q perder todas as cartas
            }
            else if (AcaoDeclarada == AcaoTurno.Duque)
            {
                Moedas += 3;
            }
            else if (AcaoDeclarada == AcaoTurno.Caitao)
            {
                Moedas += 2;
                Alvo.Moedas -= 2;
            }
            else if (AcaoDeclarada == AcaoTurno.Asassino)
            {
                Moedas -= 3;

                Alvo.Cartas.Remove(Alvo.Cartas[CartaAlvo]);

                //declarar fim do jogo para o jogador q perder todas as cartas
            }
            else if (AcaoDeclarada == AcaoTurno.Asassino)
            {
                //devolver as cartas para o baralho antes de remover
                Cartas.RemoveAll(x => true);
                Cartas.AddRange(CartasNovas);
            }
            else if (AcaoDeclarada == AcaoTurno.Inquisitor)
            {
                //devolver as cartas para o baralho antes de remover
                Cartas.RemoveAll(x => true);
                Cartas.AddRange(CartasNovas);
            }
        }
    }

    //public class Personagens
    //{
    //    public string Nome { get; set; }
    //    public List<string> Habilidades { get; set; }
    //} 

    public enum AcaoTurnoEnum
    {
        Renda,
        AjudaExterna,
        GolpeDeEstado,

        Duque,
        Caitao,
        Asassino,
        Condesa,
        Embaixador,
        Inquisitor
    }


    public class AcaoTurno
    {
        public int Id { get; set; }
        public AcaoTurnoEnum acao { get; set; }
        public string Nome { get; set; }
        public string Descrição { get; set; }
    }

    public class Carta
    {
        public int Id { get; set; }
        public string Nome { get; set; }
    }
}


